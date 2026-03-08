import { TRPCError } from '@trpc/server';
import { logger } from '../lib/logger.js';
import {
  generateEmbedding,
  callLLM,
  resolveApiKey,
  selectModel,
  SYSTEM_PROMPTS,
  type LLMMessage,
} from './ai.service.js';

// ─── Types ───────────────────────────────────────────────────

/** A node returned as part of a subgraph query result */
export interface SubgraphNode {
  id: string;
  oir_id: string;
  type: string;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  signature: string | null;
  doc_comment: string | null;
  metadata: Record<string, unknown> | null;
  /** How this node was discovered */
  source: 'seed' | 'traversal' | 'semantic';
  /** Relevance score (0-1) for semantic matches */
  relevance?: number;
}

/** An edge returned as part of a subgraph query result */
export interface SubgraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  type: string;
  metadata: Record<string, unknown> | null;
}

/** Full result of an AI graph query */
export interface GraphQueryResult {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  explanation: string;
  /** Step-by-step explanation of how the subgraph was built */
  steps: string[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    model: string;
  };
}

/** Overview graph for the landing page */
export interface OverviewResult {
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  summary: string | null;
}

// DB client type — matches Supabase client interface
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (...args: any[]) => any; rpc: (...args: any[]) => any };

// ─── Main Query Functions ────────────────────────────────────

/**
 * AI-driven graph query. The primary entry point for "ask anything about your codebase".
 *
 * Pipeline: embed query → vector search → traverse neighbors → merge → LLM explain
 */
export async function querySubgraph(
  projectId: string,
  query: string,
  userId: string,
  db: DbClient,
  adminDb: DbClient,
  apiKeyId?: string,
  contextNodeIds?: string[],
  modelPreference?: 'auto' | 'fast' | 'powerful',
): Promise<GraphQueryResult> {
  const steps: string[] = [];

  // 1. Resolve API key (BYOK or platform)
  const resolvedKey = await resolveApiKey(userId, db, {
    apiKeyId,
    projectId,
  });
  steps.push(`Using ${resolvedKey.source} ${resolvedKey.provider} key`);

  // 2. Generate embedding for the query
  const embedding = await generateEmbedding(query);
  steps.push('Generated query embedding');

  // 3. Semantic search — find seed nodes
  const { data: semanticHits, error: searchError } = await adminDb.rpc('match_code_nodes', {
    p_project_id: projectId,
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.72, // Slightly lower threshold for broader recall
    match_count: 15,
  });

  if (searchError) {
    logger.warn({ searchError, projectId }, 'Semantic search failed in querySubgraph');
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Semantic search failed',
    });
  }

  const seedNodes = (semanticHits ?? []) as Array<{
    id: string;
    oir_id: string;
    type: string;
    name: string;
    file_path: string;
    line_start: number | null;
    line_end: number | null;
    signature: string | null;
    doc_comment: string | null;
    metadata: Record<string, unknown> | null;
    similarity: number;
  }>;
  steps.push(`Found ${seedNodes.length} seed nodes via semantic search`);

  // Inject explicit context node IDs (from #mentions) as additional seeds
  if (contextNodeIds && contextNodeIds.length > 0) {
    const { data: mentionedNodes } = await adminDb
      .from('code_nodes')
      .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
      .eq('project_id', projectId)
      .in('id', contextNodeIds);

    for (const mn of mentionedNodes ?? []) {
      const alreadySeed = seedNodes.some((s) => s.id === mn.id);
      if (!alreadySeed) {
        seedNodes.push({ ...mn, similarity: 1.0 });
      }
    }
    steps.push(`Added ${contextNodeIds.length} context node(s) from #mentions`);
  }

  if (seedNodes.length === 0) {
    // No relevant nodes found — ask LLM for a helpful response anyway
    const llmResult = await callLLM(
      [
        { role: 'system', content: SYSTEM_PROMPTS.graphQuery },
        {
          role: 'user',
          content: `The user asked: "${query}"\n\nNo relevant code nodes were found in the project. Please provide a helpful response explaining that the query didn't match any known code structures, and suggest how the user might rephrase their question.`,
        },
      ],
      resolvedKey,
    );

    return {
      nodes: [],
      edges: [],
      explanation: llmResult.content,
      steps,
      usage: { ...llmResult.usage, model: llmResult.model },
    };
  }

  // 4. Traverse 1-hop neighbors from top seed nodes (limit traversal to top 5 seeds)
  const topSeeds = seedNodes.slice(0, 5);
  const allNodeIds = new Set<string>(seedNodes.map((n) => n.id));
  const traversalNodes: Array<Record<string, unknown>> = [];

  for (const seed of topSeeds) {
    const { data: neighbors } = await adminDb.rpc('traverse_graph', {
      p_node_id: seed.id,
      p_direction: 'both',
      p_max_depth: 1,
    });

    if (neighbors) {
      for (const n of neighbors as Array<Record<string, unknown>>) {
        const nid = String(n.id ?? '');
        if (nid && !allNodeIds.has(nid)) {
          allNodeIds.add(nid);
          traversalNodes.push(n);
        }
      }
    }
  }
  steps.push(`Expanded to ${allNodeIds.size} nodes via 1-hop traversal`);

  // 5. Cap total nodes at 80 to keep the response manageable
  const MAX_NODES = 80;
  const nodeIds = [...allNodeIds].slice(0, MAX_NODES);

  // 6. Fetch full node data for all collected node IDs
  const { data: fullNodes, error: nodesError } = await adminDb
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
    .eq('project_id', projectId)
    .in('id', nodeIds);

  if (nodesError) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch nodes',
    });
  }

  // 7. Fetch edges between the collected nodes
  const { data: edges, error: edgesError } = await adminDb
    .from('code_edges')
    .select('id, source_node_id, target_node_id, type, metadata')
    .eq('project_id', projectId)
    .in('source_node_id', nodeIds)
    .in('target_node_id', nodeIds);

  if (edgesError) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch edges',
    });
  }

  // 8. Build subgraph nodes with source annotation
  const seedIdSet = new Set(seedNodes.map((n) => n.id));
  const similarityMap = new Map(seedNodes.map((n) => [n.id, n.similarity]));

  const subgraphNodes: SubgraphNode[] = (fullNodes ?? []).map((n: Record<string, unknown>) => ({
    id: String(n.id),
    oir_id: String(n.oir_id),
    type: String(n.type),
    name: String(n.name),
    file_path: String(n.file_path),
    line_start: n.line_start as number | null,
    line_end: n.line_end as number | null,
    signature: n.signature as string | null,
    doc_comment: n.doc_comment as string | null,
    metadata: n.metadata as Record<string, unknown> | null,
    source: seedIdSet.has(String(n.id)) ? ('seed' as const) : ('traversal' as const),
    relevance: similarityMap.get(String(n.id)),
  }));

  const subgraphEdges: SubgraphEdge[] = (edges ?? []).map((e: Record<string, unknown>) => ({
    id: String(e.id),
    source_node_id: String(e.source_node_id),
    target_node_id: String(e.target_node_id),
    type: String(e.type),
    metadata: e.metadata as Record<string, unknown> | null,
  }));

  // 9. Build context for LLM explanation
  const contextText = _buildGraphContext(subgraphNodes, subgraphEdges);

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPTS.graphQuery },
    {
      role: 'user',
      content: `User question: "${query}"\n\n${contextText}`,
    },
  ];

  const model = selectModel('graphQuery', query, resolvedKey.provider, modelPreference);
  const llmResult = await callLLM(llmMessages, resolvedKey, { maxTokens: 2048, model });
  steps.push('Generated AI explanation');

  return {
    nodes: subgraphNodes,
    edges: subgraphEdges,
    explanation: llmResult.content,
    steps,
    usage: {
      promptTokens: llmResult.usage.promptTokens,
      completionTokens: llmResult.usage.completionTokens,
      model: llmResult.model,
    },
  };
}

/**
 * Get overview nodes for the smart landing page.
 * Returns high-level structural nodes (modules, packages, namespaces, routes)
 * plus edges between them — typically 20-50 nodes.
 */
export async function getOverviewGraph(
  projectId: string,
  db: DbClient,
): Promise<OverviewResult> {
  // Fetch structural/high-level nodes
  const overviewTypes = ['module', 'package', 'namespace', 'route', 'component', 'class'];

  const { data: nodes, error: nodesError } = await db
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
    .eq('project_id', projectId)
    .in('type', overviewTypes)
    .order('type')
    .order('name')
    .limit(60);

  if (nodesError) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch overview nodes',
    });
  }

  if (!nodes || nodes.length === 0) {
    // If no structural nodes, fall back to top-level functions/classes
    const { data: fallback } = await db
      .from('code_nodes')
      .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
      .eq('project_id', projectId)
      .in('type', ['function', 'class', 'component'])
      .order('name')
      .limit(40);

    const fallbackNodes = (fallback ?? []).map((n: Record<string, unknown>) =>
      _toSubgraphNode(n, 'seed'),
    );

    return { nodes: fallbackNodes, edges: [], summary: null };
  }

  const nodeIds = nodes.map((n: Record<string, unknown>) => String(n.id));

  // Fetch edges between these overview nodes
  const { data: edges } = await db
    .from('code_edges')
    .select('id, source_node_id, target_node_id, type, metadata')
    .eq('project_id', projectId)
    .in('source_node_id', nodeIds)
    .in('target_node_id', nodeIds);

  const subgraphNodes = nodes.map((n: Record<string, unknown>) => _toSubgraphNode(n, 'seed'));
  const subgraphEdges = (edges ?? []).map((e: Record<string, unknown>) => _toSubgraphEdge(e));

  return {
    nodes: subgraphNodes,
    edges: subgraphEdges,
    summary: null,
  };
}

/**
 * Get subgraph for errors — nodes with error snapshots + their neighbors.
 */
export async function getErrorSubgraph(
  projectId: string,
  _db: DbClient,
  adminDb: DbClient,
  limit = 30,
): Promise<{ nodes: SubgraphNode[]; edges: SubgraphEdge[] }> {
  // Get nodes that have recent error snapshots
  const { data: errorNodes } = await adminDb
    .from('error_snapshots')
    .select('code_node_id')
    .eq('project_id', projectId)
    .not('code_node_id', 'is', null)
    .order('last_seen_at', { ascending: false })
    .limit(limit);

  const errorNodeIds = [...new Set((errorNodes ?? []).map((e: Record<string, unknown>) => String(e.code_node_id)))];

  if (errorNodeIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Fetch the error nodes
  const { data: _errorNodesFull } = await adminDb
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
    .eq('project_id', projectId)
    .in('id', errorNodeIds);

  // 1-hop neighbors for context
  const allNodeIds = new Set(errorNodeIds);
  for (const nodeId of errorNodeIds.slice(0, 10)) {
    const { data: neighbors } = await adminDb.rpc('traverse_graph', {
      p_node_id: nodeId,
      p_direction: 'both',
      p_max_depth: 1,
    });
    if (neighbors) {
      for (const n of neighbors as Array<Record<string, unknown>>) {
        allNodeIds.add(String(n.id));
      }
    }
  }

  // Fetch all nodes including neighbors
  const allIds = [...allNodeIds].slice(0, 80);
  const { data: fullNodes } = await adminDb
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
    .eq('project_id', projectId)
    .in('id', allIds);

  const { data: edges } = await adminDb
    .from('code_edges')
    .select('id, source_node_id, target_node_id, type, metadata')
    .eq('project_id', projectId)
    .in('source_node_id', allIds)
    .in('target_node_id', allIds);

  const errorIdSet = new Set(errorNodeIds);
  const subgraphNodes = (fullNodes ?? []).map((n: Record<string, unknown>) =>
    _toSubgraphNode(n, errorIdSet.has(String(n.id)) ? 'seed' : 'traversal'),
  );

  return {
    nodes: subgraphNodes,
    edges: (edges ?? []).map((e: Record<string, unknown>) => _toSubgraphEdge(e)),
  };
}

/**
 * Get subgraph for a trace — spans linked to code nodes + their neighbors.
 */
export async function getTraceSubgraph(
  projectId: string,
  traceId: string,
  _db: DbClient,
  adminDb: DbClient,
): Promise<{ nodes: SubgraphNode[]; edges: SubgraphEdge[]; spans: Record<string, unknown>[] }> {
  // Fetch spans for this trace
  const { data: spans } = await adminDb
    .from('spans')
    .select('id, span_id, parent_span_id, code_node_id, service_name, operation, kind, started_at, ended_at, duration_ms, status, error_message')
    .eq('project_id', projectId)
    .eq('trace_id', traceId)
    .order('started_at', { ascending: true });

  if (!spans || spans.length === 0) {
    return { nodes: [], edges: [], spans: [] };
  }

  // Get unique code_node_ids from spans
  const codeNodeIds = [...new Set(
    (spans as Array<Record<string, unknown>>)
      .map((s) => s.code_node_id)
      .filter(Boolean)
      .map(String),
  )];

  if (codeNodeIds.length === 0) {
    return { nodes: [], edges: [], spans: spans as Record<string, unknown>[] };
  }

  // Fetch the linked code nodes
  const { data: nodes } = await adminDb
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
    .eq('project_id', projectId)
    .in('id', codeNodeIds);

  // Fetch edges between trace nodes
  const { data: edges } = await adminDb
    .from('code_edges')
    .select('id, source_node_id, target_node_id, type, metadata')
    .eq('project_id', projectId)
    .in('source_node_id', codeNodeIds)
    .in('target_node_id', codeNodeIds);

  return {
    nodes: (nodes ?? []).map((n: Record<string, unknown>) => _toSubgraphNode(n, 'seed')),
    edges: (edges ?? []).map((e: Record<string, unknown>) => _toSubgraphEdge(e)),
    spans: spans as Record<string, unknown>[],
  };
}

/**
 * Get dependency subgraph from a specific node — upstream callers or downstream dependencies.
 */
export async function getDependencySubgraph(
  projectId: string,
  nodeId: string,
  direction: 'upstream' | 'downstream' | 'both',
  maxDepth: number,
  _db: DbClient,
  adminDb: DbClient,
): Promise<{ nodes: SubgraphNode[]; edges: SubgraphEdge[]; rootNode: SubgraphNode | null }> {
  // Fetch the root node
  const { data: rootNodeData } = await adminDb
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .single();

  if (!rootNodeData) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Node not found' });
  }

  // Traverse the graph
  const { data: neighbors } = await adminDb.rpc('traverse_graph', {
    p_node_id: nodeId,
    p_direction: direction,
    p_max_depth: maxDepth,
  });

  const allNodeIds = new Set<string>([nodeId]);
  if (neighbors) {
    for (const n of neighbors as Array<Record<string, unknown>>) {
      allNodeIds.add(String(n.id));
    }
  }

  const allIds = [...allNodeIds].slice(0, 100);

  // Fetch all nodes
  const { data: nodes } = await adminDb
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
    .eq('project_id', projectId)
    .in('id', allIds);

  // Fetch edges
  const { data: edges } = await adminDb
    .from('code_edges')
    .select('id, source_node_id, target_node_id, type, metadata')
    .eq('project_id', projectId)
    .in('source_node_id', allIds)
    .in('target_node_id', allIds);

  return {
    nodes: (nodes ?? []).map((n: Record<string, unknown>) =>
      _toSubgraphNode(n, String(n.id) === nodeId ? 'seed' : 'traversal'),
    ),
    edges: (edges ?? []).map((e: Record<string, unknown>) => _toSubgraphEdge(e)),
    rootNode: _toSubgraphNode(rootNodeData as Record<string, unknown>, 'seed'),
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function _toSubgraphNode(n: Record<string, unknown>, source: 'seed' | 'traversal' | 'semantic'): SubgraphNode {
  return {
    id: String(n.id),
    oir_id: String(n.oir_id),
    type: String(n.type),
    name: String(n.name),
    file_path: String(n.file_path),
    line_start: n.line_start as number | null,
    line_end: n.line_end as number | null,
    signature: n.signature as string | null,
    doc_comment: n.doc_comment as string | null,
    metadata: n.metadata as Record<string, unknown> | null,
    source,
  };
}

function _toSubgraphEdge(e: Record<string, unknown>): SubgraphEdge {
  return {
    id: String(e.id),
    source_node_id: String(e.source_node_id),
    target_node_id: String(e.target_node_id),
    type: String(e.type),
    metadata: e.metadata as Record<string, unknown> | null,
  };
}

function _buildGraphContext(nodes: SubgraphNode[], edges: SubgraphEdge[]): string {
  const sections: string[] = [];

  // Group nodes by type
  const nodesByType = new Map<string, SubgraphNode[]>();
  for (const node of nodes) {
    const existing = nodesByType.get(node.type) ?? [];
    existing.push(node);
    nodesByType.set(node.type, existing);
  }

  sections.push(`## Code Graph (${nodes.length} nodes, ${edges.length} edges)\n`);

  for (const [type, typeNodes] of nodesByType) {
    const lines = typeNodes.map((n) => {
      const sig = n.signature ? ` — \`${n.signature}\`` : '';
      const doc = n.doc_comment ? ` — ${n.doc_comment.slice(0, 100)}` : '';
      const rel = n.relevance != null ? ` (relevance: ${n.relevance.toFixed(2)})` : '';
      return `  - **${n.name}** in \`${n.file_path}:${n.line_start ?? '?'}\`${sig}${doc}${rel}`;
    });
    sections.push(`### ${type} (${typeNodes.length})\n${lines.join('\n')}`);
  }

  // Summarize edges
  if (edges.length > 0) {
    const nodeNameMap = new Map(nodes.map((n) => [n.id, n.name]));
    const edgeLines = edges.slice(0, 40).map((e) => {
      const src = nodeNameMap.get(e.source_node_id) ?? '?';
      const tgt = nodeNameMap.get(e.target_node_id) ?? '?';
      return `  - ${src} —[${e.type}]→ ${tgt}`;
    });
    sections.push(`### Relationships\n${edgeLines.join('\n')}`);
    if (edges.length > 40) {
      sections.push(`  ... and ${edges.length - 40} more edges`);
    }
  }

  return sections.join('\n\n');
}
