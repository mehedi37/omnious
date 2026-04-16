/**
 * clustering.service.ts — Semantic node clustering for code graphs.
 *
 * Runs community detection (label propagation via PG) and classifies clusters
 * into architectural layers. Persists results in `code_node_clusters` for
 * fast retrieval. Automatically triggered after CLI push.
 */
import { logger } from '../lib/logger.js';
import {
  callLLM,
  selectModel,
  type LLMMessage,
  type ResolvedKey,
} from './ai.service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (...args: any[]) => any; rpc: (...args: any[]) => any };

// ─── Constants ────────────────────────────────────────────────

const CLUSTER_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#d946ef',
  '#16a34a', '#dc2626', '#ca8a04', '#7c3aed', '#be185d',
];

const MAX_CLUSTERS = 25;

/** Architectural layer patterns — matches directory/file name conventions */
const LAYER_PATTERNS: Array<{ layer: string; patterns: RegExp[] }> = [
  {
    layer: 'controller',
    patterns: [/controller/i, /route/i, /handler/i, /endpoint/i, /api\//i, /pages\//i, /app\//i],
  },
  {
    layer: 'service',
    patterns: [/service/i, /use[-_]?case/i, /business/i, /logic/i, /hook/i],
  },
  {
    layer: 'repository',
    patterns: [/repo/i, /repository/i, /dal/i, /data[-_]?access/i, /model/i, /schema/i, /migration/i],
  },
  {
    layer: 'model',
    patterns: [/model/i, /entity/i, /type/i, /interface/i, /dto/i, /schema/i],
  },
  {
    layer: 'component',
    patterns: [/component/i, /widget/i, /ui\//i, /view/i],
  },
  {
    layer: 'util',
    patterns: [/util/i, /helper/i, /lib\//i, /common/i, /shared/i, /tool/i],
  },
  {
    layer: 'config',
    patterns: [/config/i, /env/i, /constant/i, /setting/i],
  },
  {
    layer: 'test',
    patterns: [/test/i, /spec/i, /__test/i, /\.test\./i, /\.spec\./i],
  },
];

// ─── Types ────────────────────────────────────────────────────

export interface ClusterResult {
  id: string;
  label: string;
  color: string;
  layer: string | null;
  nodeIds: string[];
  nodeCount: number;
  representativeDir: string;
}

interface CommunityRow {
  node_id: string;
  node_name: string;
  node_type: string;
  file_path: string;
  community: string;
}

// ─── Layer Detection ──────────────────────────────────────────

/**
 * Classify a cluster into an architectural layer based on its
 * most common directory path and member node types.
 */
function classifyLayer(
  representativeDir: string,
  members: Array<{ type: string; file_path: string }>,
): string | null {
  // Check directory path against layer patterns
  for (const { layer, patterns } of LAYER_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(representativeDir)) return layer;
    }
  }

  // Check individual file paths
  const layerScores = new Map<string, number>();
  for (const member of members) {
    for (const { layer, patterns } of LAYER_PATTERNS) {
      for (const pattern of patterns) {
        if (pattern.test(member.file_path)) {
          layerScores.set(layer, (layerScores.get(layer) ?? 0) + 1);
          break;
        }
      }
    }
  }

  // Pick the layer with the highest score
  if (layerScores.size > 0) {
    const sorted = [...layerScores.entries()].sort((a, b) => b[1] - a[1]);
    const [topLayer, topCount] = sorted[0]!;
    // Only classify if > 30% of members match
    if (topCount / members.length > 0.3) return topLayer;
  }

  return null;
}

/**
 * Derive a human-readable label from the representative directory.
 * e.g., "src/services" → "services", "frontend/src/components/graph" → "graph components"
 */
function deriveLabel(representativeDir: string, layer: string | null): string {
  const parts = representativeDir
    .replace(/^(\.\/|src\/|frontend\/src\/|backend\/src\/)/, '')
    .split('/')
    .filter(Boolean);

  const label = parts.length > 0 ? parts.join('/') : 'root';

  // Append layer hint if different from directory name
  if (layer && !label.toLowerCase().includes(layer)) {
    return `${label} (${layer})`;
  }
  return label;
}

// ─── Core Clustering ──────────────────────────────────────────

/**
 * Run community detection on a project and persist the results.
 *
 * Pipeline:
 * 1. Call `detect_communities` PG function (label propagation)
 * 2. Group results into clusters
 * 3. Classify each cluster's architectural layer
 * 4. Persist to `code_node_clusters` table (replace-all)
 */
export async function computeAndPersistClusters(
  projectId: string,
  adminDb: DbClient,
): Promise<ClusterResult[]> {
  logger.info({ projectId }, 'Starting community detection');

  // 1. Run label propagation
  const { data, error } = await adminDb.rpc('detect_communities', {
    p_project_id: projectId,
    p_max_iterations: 15,
  });

  if (error) {
    logger.error({ projectId, error: error.message }, 'Community detection RPC failed');
    throw new Error(`Community detection failed: ${error.message}`);
  }

  const rows = (data ?? []) as CommunityRow[];
  if (rows.length === 0) {
    logger.info({ projectId }, 'No nodes found for community detection');
    // Clear existing clusters
    await adminDb
      .from('code_node_clusters')
      .delete()
      .eq('project_id', projectId);
    return [];
  }

  // 2. Group by community leader
  const communityMap = new Map<string, Array<{ id: string; name: string; type: string; file_path: string }>>();
  for (const row of rows) {
    const communityId = row.community;
    const arr = communityMap.get(communityId) ?? [];
    arr.push({
      id: row.node_id,
      name: row.node_name,
      type: row.node_type,
      file_path: row.file_path,
    });
    communityMap.set(communityId, arr);
  }

  // 3. Build cluster results, sorted by size (largest first), capped at MAX_CLUSTERS
  const clusters: ClusterResult[] = [...communityMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CLUSTERS)
    .map(([communityId, members], idx) => {
      // Derive representative directory (most common dir prefix)
      const dirs = members.map((m) => {
        const parts = m.file_path.split('/');
        return parts.length > 1 ? parts.slice(0, -1).join('/') : '/';
      });
      const dirCounts = new Map<string, number>();
      for (const d of dirs) dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
      const representativeDir = [...dirCounts.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'misc';

      // Classify architectural layer
      const layer = classifyLayer(representativeDir, members);

      // Derive label
      const label = deriveLabel(representativeDir, layer);

      return {
        id: communityId,
        label,
        color: CLUSTER_COLORS[idx % CLUSTER_COLORS.length]!,
        layer,
        nodeIds: members.map((m) => m.id),
        nodeCount: members.length,
        representativeDir,
      };
    });

  // 4. Persist: delete old clusters, insert new ones (within a transaction)
  await adminDb
    .from('code_node_clusters')
    .delete()
    .eq('project_id', projectId);

  if (clusters.length > 0) {
    const insertRows = clusters.map((c) => ({
      project_id: projectId,
      cluster_label: c.label,
      cluster_color: c.color,
      layer: c.layer,
      node_ids: c.nodeIds,
      node_count: c.nodeCount,
      representative_dir: c.representativeDir,
    }));

    const { error: insertError } = await adminDb
      .from('code_node_clusters')
      .insert(insertRows);

    if (insertError) {
      logger.error({ projectId, error: insertError.message }, 'Failed to persist clusters');
      throw new Error(`Failed to persist clusters: ${insertError.message}`);
    }
  }

  logger.info(
    { projectId, clusterCount: clusters.length, totalNodes: rows.length },
    'Community detection complete and persisted',
  );

  return clusters;
}

/**
 * Fetch persisted clusters for a project (fast read — no computation).
 */
export async function getClusters(
  projectId: string,
  db: DbClient,
): Promise<ClusterResult[]> {
  const { data, error } = await db
    .from('code_node_clusters')
    .select('*')
    .eq('project_id', projectId)
    .order('node_count', { ascending: false });

  if (error) {
    logger.error({ projectId, error: error.message }, 'Failed to fetch clusters');
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    label: row.cluster_label as string,
    color: row.cluster_color as string,
    layer: (row.layer as string) ?? null,
    nodeIds: (row.node_ids as string[]) ?? [],
    nodeCount: (row.node_count as number) ?? 0,
    representativeDir: (row.representative_dir as string) ?? '',
  }));
}

// ─── LLM-Enhanced Cluster Labeling ───────────────────────────

/**
 * Use LLM to generate better cluster labels (optional enhancement).
 * Called asynchronously after basic clustering — results update the
 * persisted cluster labels.
 */
export async function enhanceClusterLabels(
  projectId: string,
  clusters: ClusterResult[],
  resolvedKey: ResolvedKey,
  adminDb: DbClient,
): Promise<void> {
  if (clusters.length === 0) return;

  // Build compact cluster summary for LLM
  const clusterSummary = clusters
    .slice(0, 15)
    .map((c, i) => {
      const sampleNodes = c.nodeIds.length > 0
        ? ` (sample members: ${c.nodeIds.slice(0, 5).join(', ')})`
        : '';
      return `${i + 1}. dir="${c.representativeDir}", layer=${c.layer ?? 'unknown'}, ${c.nodeCount} nodes${sampleNodes}`;
    })
    .join('\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `You are a software architecture expert. Given a list of code clusters detected by community detection, generate a short descriptive label (2-5 words) for each cluster.
Output ONLY a numbered list matching the input order, one label per line. Example:
1. Authentication Services
2. Database Models
3. React UI Components`,
    },
    { role: 'user', content: `Label these clusters:\n\n${clusterSummary}` },
  ];

  try {
    const model = selectModel('overview', '', resolvedKey.provider, 'fast');
    const result = await callLLM(messages, resolvedKey, {
      model,
      maxTokens: 256,
      temperature: 0,
    });

    // Parse numbered labels
    const lines = result.content.split('\n').filter((l) => /^\d+\./.test(l.trim()));
    for (let i = 0; i < Math.min(lines.length, clusters.length); i++) {
      const label = lines[i]!.replace(/^\d+\.\s*/, '').trim();
      if (label.length > 0 && label.length <= 60) {
        const cluster = clusters[i]!;
        await adminDb
          .from('code_node_clusters')
          .update({ cluster_label: label })
          .eq('project_id', projectId)
          .eq('cluster_label', cluster.label);
      }
    }

    logger.info({ projectId, enhanced: lines.length }, 'LLM cluster label enhancement complete');
  } catch (err) {
    logger.warn(
      { projectId, error: err instanceof Error ? err.message : String(err) },
      'LLM cluster label enhancement failed (non-fatal)',
    );
  }
}

// ─── Narrative Generation ────────────────────────────────────

export interface SliceNarrative {
  summary: string;
  pattern: string | null;
  dataFlow: string | null;
  followUpQuestions: string[];
}

/**
 * Generate a natural language narrative for a graph slice.
 * Describes what the slice shows, detected patterns, and data flow.
 */
export async function generateSliceNarrative(
  nodes: Array<{ name: string; type: string; file_path: string }>,
  edges: Array<{ source: string; target: string; type: string }>,
  query: string,
  explanation: string,
  resolvedKey: ResolvedKey,
): Promise<SliceNarrative> {
  // Build a compact graph description
  const nodeDescs = nodes
    .slice(0, 30)
    .map((n) => `${n.type}:${n.name} (${n.file_path})`)
    .join('\n');

  const edgeDescs = edges
    .slice(0, 40)
    .map((e) => `${e.source} -[${e.type}]-> ${e.target}`)
    .join('\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: `You are a code architecture narrator. Given a graph slice (nodes and edges) from a codebase, generate a narrative that tells the "story" of this code.

Output JSON with exactly these fields:
{
  "summary": "2-3 sentence natural language description of what this slice shows",
  "pattern": "detected architectural pattern (e.g., 'MVC controller → service → repository') or null",
  "dataFlow": "description of data flow direction (e.g., 'Request enters via LoginController...') or null",
  "followUpQuestions": ["3 suggested follow-up questions"]
}`,
    },
    {
      role: 'user',
      content: `Query: "${query}"

Nodes:\n${nodeDescs}

Edges:\n${edgeDescs}

AI explanation:\n${explanation.slice(0, 500)}`,
    },
  ];

  try {
    const model = selectModel('overview', '', resolvedKey.provider, 'fast');
    const result = await callLLM(messages, resolvedKey, {
      model,
      maxTokens: 512,
      temperature: 0.3,
    });

    // Parse JSON from response
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : 'Graph slice visualization',
        pattern: typeof parsed.pattern === 'string' ? parsed.pattern : null,
        dataFlow: typeof parsed.dataFlow === 'string' ? parsed.dataFlow : null,
        followUpQuestions: Array.isArray(parsed.followUpQuestions)
          ? (parsed.followUpQuestions as unknown[]).filter((q): q is string => typeof q === 'string').slice(0, 3)
          : [],
      };
    }

    return {
      summary: result.content.slice(0, 200),
      pattern: null,
      dataFlow: null,
      followUpQuestions: [],
    };
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'Narrative generation failed',
    );
    return {
      summary: `Graph showing: ${query}`,
      pattern: null,
      dataFlow: null,
      followUpQuestions: [],
    };
  }
}
