import { TRPCError } from '@trpc/server';
import { logger } from '../lib/logger.js';
import {
  generateEmbedding,
  generateHyDE,
  evaluateRetrievalSufficiency,
  callLLM,
  callLLMStream,
  resolveApiKey,
  selectModel,
  SYSTEM_PROMPTS,
  type LLMMessage,
  type ResolvedKey,
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
  /** First ~200 lines of source code (present for seed nodes) */
  code_body?: string | null;
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

export interface QueryAttachment {
  kind: 'node' | 'module' | 'function' | 'file' | 'error';
  id: string;
  label: string;
  subtype?: string;
}

/** SSE event emitted by querySubgraphStream */
export type StreamEvent =
  | { type: 'step'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; nodes: SubgraphNode[]; edges: SubgraphEdge[]; steps: string[] }
  | { type: 'error'; message: string };

/** Internal: result of the shared subgraph preparation pipeline */
interface SubgraphPayload {
  resolvedKey: ResolvedKey;
  nodes: SubgraphNode[];
  edges: SubgraphEdge[];
  llmMessages: LLMMessage[];
  model: string;
  steps: string[];
}

// DB client type — matches Supabase client interface
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (...args: any[]) => any; rpc: (...args: any[]) => any };

// ─── Query Classification ────────────────────────────────────

/** Keywords that signal a debug/error investigation query (2-hop) */
const DEBUG_KEYWORDS = [
  'error', 'bug', 'crash', 'fail', 'broke', 'exception', 'stack trace',
  'why', 'root cause', 'debug', 'fix', 'issue', 'problem', 'wrong',
  'null', 'undefined', 'timeout', 'leak', 'race condition',
];

/** Keywords that signal a path/flow/architecture query (3-hop) */
const PATH_KEYWORDS = [
  'path between', 'flow from', 'how does.*reach', 'call chain',
  'dependency chain', 'trace from', 'data flow', 'request flow',
  'end to end', 'pipeline', 'sequence',
];

/**
 * Classify a user query to determine the optimal graph traversal depth.
 * - 1-hop: navigation/lookup queries ("what is X?", "show me Y")
 * - 2-hop: debug/investigation queries ("why does X fail?", "what causes Y?")
 * - 3-hop: path/flow queries ("how does data flow from X to Y?")
 */
function _classifyTraversalDepth(query: string): { depth: number; reason: string } {
  const lower = query.toLowerCase();

  // Check path queries first (most specific)
  for (const kw of PATH_KEYWORDS) {
    if (new RegExp(kw).test(lower)) {
      return { depth: 3, reason: `path/flow query (matched: "${kw}")` };
    }
  }

  // Check debug queries
  const debugMatches = DEBUG_KEYWORDS.filter((kw) => lower.includes(kw));
  if (debugMatches.length >= 2) {
    return { depth: 2, reason: `debug query (matched: ${debugMatches.slice(0, 3).join(', ')})` };
  }
  if (debugMatches.length === 1) {
    return { depth: 2, reason: `debug query (matched: ${debugMatches[0]})` };
  }

  // Default: navigation/lookup
  return { depth: 1, reason: 'navigation query (default)' };
}

// ─── Main Query Functions ────────────────────────────────────

/**
 * Internal shared pipeline. Resolves keys, embeds the query, builds the subgraph,
 * and returns everything the caller needs to run the LLM (blocking or streaming).
 */
async function _buildSubgraphPayload(
  projectId: string,
  query: string,
  userId: string,
  db: DbClient,
  adminDb: DbClient,
  apiKeyId?: string,
  contextNodeIds?: string[],
  attachments?: QueryAttachment[],
  modelPreference?: 'auto' | 'fast' | 'powerful',
): Promise<SubgraphPayload> {
  const steps: string[] = [];
  const attachmentContextLines: string[] = [];

  // 1. Resolve API key (BYOK or platform)
  const resolvedKey = await resolveApiKey(userId, db, {
    apiKeyId,
    projectId,
  });
  steps.push(`Using ${resolvedKey.source} ${resolvedKey.provider} key`);

  // 2. Generate embedding — use HyDE for complex queries, direct embedding for simple ones
  const lowerQuery = query.toLowerCase();
  const isComplexQuery = query.length > 40 || DEBUG_KEYWORDS.some((kw) => lowerQuery.includes(kw))
    || PATH_KEYWORDS.some((kw) => new RegExp(kw).test(lowerQuery));

  let embedding: number[];
  if (isComplexQuery) {
    const fastModel = selectModel('overview', '', resolvedKey.provider, 'fast');
    const hyde = await generateHyDE(query, resolvedKey, fastModel);
    embedding = hyde.embedding;
    steps.push(hyde.hypothetical ? 'Generated HyDE embedding (hypothetical code)' : 'Generated query embedding (HyDE fallback)');
  } else {
    embedding = await generateEmbedding(query);
    steps.push('Generated query embedding');
  }

  // 3. Multi-signal ranked search — find seed nodes using weighted scoring:
  //    semantic similarity, trigram matching, graph centrality, error frequency, recency
  const identifierTokens = query.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  const queryText = identifierTokens.join(' ');

  // Boost error signal weight for debug-oriented queries
  const isDebugQuery = DEBUG_KEYWORDS.some((kw) => lowerQuery.includes(kw));
  const weights = isDebugQuery
    ? { w_semantic: 0.40, w_trigram: 0.10, w_centrality: 0.10, w_error: 0.30, w_recency: 0.10 }
    : { w_semantic: 0.50, w_trigram: 0.15, w_centrality: 0.15, w_error: 0.15, w_recency: 0.05 };

  let seedNodes: Array<{
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

  const { data: rankedHits, error: rankedError } = await adminDb.rpc('match_code_nodes_ranked', {
    p_project_id: projectId,
    query_embedding: JSON.stringify(embedding),
    query_text: queryText,
    match_threshold: 0.50,
    match_count: 15,
    ...weights,
  });

  if (rankedError) {
    logger.warn({ rankedError, projectId }, 'Ranked search failed, falling back to vector-only');
    const { data: fallbackHits } = await adminDb.rpc('match_code_nodes', {
      p_project_id: projectId,
      query_embedding: JSON.stringify(embedding),
      match_threshold: 0.65,
      match_count: 15,
    });
    seedNodes = ((fallbackHits ?? []) as Array<Record<string, unknown>>).map((n) => ({
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
      similarity: Number(n.similarity ?? 0),
    }));
    steps.push(`Found ${seedNodes.length} seed nodes via vector search (fallback)`);
  } else {
    seedNodes = ((rankedHits ?? []) as Array<Record<string, unknown>>).map((n) => ({
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
      similarity: Number(n.ranked_score ?? n.similarity ?? 0),
    }));
    const mode = isDebugQuery ? 'debug-weighted' : 'balanced';
    steps.push(`Found ${seedNodes.length} seed nodes via multi-signal ranking (${mode})`);
  }

  // Track IDs already in seedNodes for O(1) deduplication throughout enrichment
  const seedIdSet = new Set<string>(seedNodes.map((n) => n.id));

  // Inject explicit context node IDs (from #mentions) as additional seeds
  if (contextNodeIds && contextNodeIds.length > 0) {
    const { data: mentionedNodes } = await adminDb
      .from('code_nodes')
      .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
      .eq('project_id', projectId)
      .in('id', contextNodeIds);

    for (const mn of mentionedNodes ?? []) {
      if (!seedIdSet.has(mn.id)) {
        seedNodes.push({ ...mn, similarity: 1.0 });
        seedIdSet.add(mn.id);
      }
    }
    steps.push(`Added ${contextNodeIds.length} context node(s) from #mentions`);
  }

  // Enrich seed set from typed attachments (file/error tags)
  const typedAttachments = (attachments ?? []).slice(0, 20);
  if (typedAttachments.length > 0) {
    const kindOrder: QueryAttachment['kind'][] = ['node', 'module', 'function', 'file', 'error'];
    const filterParts = kindOrder
      .map((kind) => {
        const items = typedAttachments.filter((a) => a.kind === kind);
        if (items.length === 0) return null;
        const sample = items
          .slice(0, 2)
          .map((item) => (item.label.length > 24 ? `${item.label.slice(0, 24)}...` : item.label))
          .join(', ');
        return sample ? `${kind}:${items.length} (${sample})` : `${kind}:${items.length}`;
      })
      .filter((part): part is string => Boolean(part));

    if (filterParts.length > 0) {
      steps.push(`Mention filters applied: ${filterParts.join(' | ')}`);
    }

    const filePaths = [...new Set(
      typedAttachments.filter((a) => a.kind === 'file').map((a) => a.id).filter(Boolean),
    )].slice(0, 5);

    if (filePaths.length > 0) {
      const { data: fileNodes, error: fileNodesError } = await adminDb
        .from('code_nodes')
        .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
        .eq('project_id', projectId)
        .in('file_path', filePaths)
        .limit(30);

      if (fileNodesError) {
        logger.warn({ fileNodesError, projectId }, 'File-mention enrichment query failed — skipping');
      } else {
        for (const node of fileNodes ?? []) {
          if (!seedIdSet.has(node.id)) {
            seedNodes.push({ ...node, similarity: 0.95 });
            seedIdSet.add(node.id);
          }
        }
        attachmentContextLines.push(
          `- File mentions: ${filePaths.map((p) => `\`${p}\``).join(', ')}`,
        );
        steps.push(`Added file-context seeds from ${filePaths.length} file mention(s)`);
      }
    }

    const errorIds = [...new Set(
      typedAttachments.filter((a) => a.kind === 'error').map((a) => a.id).filter(Boolean),
    )].slice(0, 5);

    if (errorIds.length > 0) {
      const { data: mentionedErrors, error: errSnapshotError } = await adminDb
        .from('error_snapshots')
        .select('id, error_type, error_message, severity, code_node_id')
        .eq('project_id', projectId)
        .in('id', errorIds);

      if (errSnapshotError) {
        logger.warn({ errSnapshotError, projectId }, 'Error-mention enrichment query failed — skipping');
      } else {
        const errorNodeIds = [...new Set(
          (mentionedErrors ?? [])
            .map((e: Record<string, unknown>) => String(e.code_node_id ?? ''))
            .filter((id: string) => !!id),
        )].slice(0, 10);

        if (errorNodeIds.length > 0) {
          const { data: errorNodes, error: errorNodesError } = await adminDb
            .from('code_nodes')
            .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
            .eq('project_id', projectId)
            .in('id', errorNodeIds);

          if (errorNodesError) {
            logger.warn({ errorNodesError, projectId }, 'Error-node enrichment query failed — skipping');
          } else {
            for (const node of errorNodes ?? []) {
              if (!seedIdSet.has(node.id)) {
                seedNodes.push({ ...node, similarity: 0.98 });
                seedIdSet.add(node.id);
              }
            }
          }
        }

        const errorSummary = (mentionedErrors ?? [])
          .slice(0, 5)
          .map((e: Record<string, unknown>) => {
            const type = String(e.error_type ?? 'Error');
            const msg = String(e.error_message ?? '').slice(0, 120);
            const sev = String(e.severity ?? 'error');
            return `${type} (${sev}): ${msg}`;
          });

        if (errorSummary.length > 0) {
          attachmentContextLines.push(`- Error mentions:\n${errorSummary.map((line: string) => `  - ${line}`).join('\n')}`);
        }
        steps.push(`Added error-context seeds from ${errorIds.length} error mention(s)`);
      }
    }
  }

  const model = selectModel('graphQuery', query, resolvedKey.provider, modelPreference);

  if (seedNodes.length === 0) {
    // No relevant nodes found — ask LLM for a helpful response anyway
    const emptyUserContent = `The user asked: "${query}"\n\n${
      attachmentContextLines.length > 0 ? `Mention context:\n${attachmentContextLines.join('\n')}\n\n` : ''
    }No relevant code nodes were found in the project. Please provide a helpful response explaining that the query didn't match any known code structures, and suggest how the user might rephrase their question.`;
    return {
      resolvedKey,
      nodes: [],
      edges: [],
      llmMessages: [
        { role: 'system', content: SYSTEM_PROMPTS.graphQuery },
        { role: 'user', content: emptyUserContent },
      ],
      model,
      steps,
    };
  }

  // 4. Classify query intent to determine traversal depth
  const { depth: traversalDepth, reason: depthReason } = _classifyTraversalDepth(query);
  steps.push(`Traversal depth: ${traversalDepth} (${depthReason})`);

  // 5. Traverse neighbors from top seed nodes
  const topSeeds = seedNodes.slice(0, 5);
  const allNodeIds = new Set<string>(seedNodes.map((n) => n.id));
  const traversalNodes: Array<Record<string, unknown>> = [];

  for (const seed of topSeeds) {
    const { data: neighbors } = await adminDb.rpc('traverse_graph', {
      p_node_id: seed.id,
      p_direction: 'both',
      p_max_depth: traversalDepth,
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
  steps.push(`Expanded to ${allNodeIds.size} nodes via ${traversalDepth}-hop traversal`);

  // 6. Cap total nodes — fit within the model's context window using token estimation.
  //    (step log added after nodeIds slice)
  //    Rough estimate: 1 node ≈ 60 tokens (label + path + signature), 1 code block ≈ 500 tokens.
  //    Reserve 2048 for the LLM reply and ~300 for system + query overhead.
  const MODEL_CONTEXT_TOKENS: Record<string, number> = {
    'gpt-4o': 128_000,
    'gpt-4o-mini': 128_000,
    'gpt-4-turbo': 128_000,
    'claude-3-5-sonnet': 200_000,
    'claude-3-5-haiku': 200_000,
    'claude-sonnet-4-5': 200_000,
  };
  const contextWindow = MODEL_CONTEXT_TOKENS[model] ?? 8_192;
  const reserved = 2_048 + 300; // reply + overhead
  const budgetForContext = contextWindow - reserved;
  const SEED_CODE_TOKENS = 500; // per seed code block (first 5 seeds)
  const NODE_TOKENS = 60; // per node metadata line
  const EDGE_TOKENS = 8; // per edge line
  const maxSeedCodeBlocks = 5;
  // Estimate how many nodes fit: budget - (5 * seed blocks) - (edges at 8 tokens each, capped at 40)
  const edgeBudget = maxSeedCodeBlocks * SEED_CODE_TOKENS + 40 * EDGE_TOKENS;
  const tokenBudgetNodes = Math.max(20, Math.floor((budgetForContext - edgeBudget) / NODE_TOKENS));
  const MAX_NODES = Math.min(tokenBudgetNodes, 200); // hard safety ceiling
  const nodeIds = [...allNodeIds].slice(0, MAX_NODES);
  steps.push(`Token-budget node cap: ${MAX_NODES} (context window: ${contextWindow.toLocaleString()}, nodes after cap: ${nodeIds.length})`);

  // 7. Fetch full node data for all collected node IDs (include code_body for seed nodes)
  const { data: fullNodes, error: nodesError } = await adminDb
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata, code_body')
    .eq('project_id', projectId)
    .in('id', nodeIds);

  if (nodesError) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to fetch nodes',
    });
  }

  // 8. Fetch edges between the collected nodes
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

  // 9. Build subgraph nodes with source annotation
  const finalSeedIdSet = new Set(seedNodes.map((n) => n.id));
  const similarityMap = new Map(seedNodes.map((n) => [n.id, n.similarity]));

  const subgraphNodes: SubgraphNode[] = (fullNodes ?? []).map((n: Record<string, unknown>) => {
    const isSeed = finalSeedIdSet.has(String(n.id));
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
      source: isSeed ? ('seed' as const) : ('traversal' as const),
      relevance: similarityMap.get(String(n.id)),
      // Include code_body only for seed nodes (direct matches) to keep context focused
      code_body: isSeed ? (n.code_body as string | null) : null,
    };
  });

  const subgraphEdges: SubgraphEdge[] = (edges ?? []).map((e: Record<string, unknown>) => ({
    id: String(e.id),
    source_node_id: String(e.source_node_id),
    target_node_id: String(e.target_node_id),
    type: String(e.type),
    metadata: e.metadata as Record<string, unknown> | null,
  }));

  // 10. Build context for LLM explanation
  let contextText = _buildGraphContext(subgraphNodes, subgraphEdges);
  const mentionContext = attachmentContextLines.length > 0
    ? `\n\nMention context:\n${attachmentContextLines.join('\n')}`
    : '';

  // 11. Agentic evaluation — for complex queries, check if context is sufficient
  //     and do ONE refinement pass if the LLM says critical info is missing.
  if (isComplexQuery && subgraphNodes.length > 0) {
    const evalModel = selectModel('overview', '', resolvedKey.provider, 'fast');
    const evaluation = await evaluateRetrievalSufficiency(
      query, contextText, resolvedKey, evalModel,
    );

    if (!evaluation.sufficient && evaluation.refinement) {
      steps.push(`Context evaluation: insufficient — "${evaluation.reason}"`);
      steps.push(`Refinement query: "${evaluation.refinement}"`);

      // Run a supplementary search with the refined query
      const refinedEmbedding = await generateEmbedding(evaluation.refinement);
      const { data: refinedHits } = await adminDb.rpc('match_code_nodes_ranked', {
        p_project_id: projectId,
        query_embedding: JSON.stringify(refinedEmbedding),
        query_text: evaluation.refinement,
        match_threshold: 0.50,
        match_count: 10,
        ...weights,
      });

      // Merge new nodes that aren't already in the subgraph
      const existingIds = new Set(subgraphNodes.map((n) => n.id));
      let added = 0;
      for (const n of ((refinedHits ?? []) as Array<Record<string, unknown>>)) {
        const nid = String(n.id);
        if (!existingIds.has(nid)) {
          subgraphNodes.push({
            id: nid,
            oir_id: String(n.oir_id),
            type: String(n.type),
            name: String(n.name),
            file_path: String(n.file_path),
            line_start: n.line_start as number | null,
            line_end: n.line_end as number | null,
            signature: n.signature as string | null,
            doc_comment: n.doc_comment as string | null,
            metadata: n.metadata as Record<string, unknown> | null,
            source: 'semantic' as const,
            relevance: Number(n.ranked_score ?? n.similarity ?? 0),
            code_body: n.code_body as string | null,
          });
          existingIds.add(nid);
          added++;
        }
      }
      if (added > 0) {
        // Rebuild context with the expanded set
        contextText = _buildGraphContext(subgraphNodes, subgraphEdges);
        steps.push(`Refinement added ${added} nodes (total: ${subgraphNodes.length})`);
      }
    } else {
      steps.push(`Context evaluation: sufficient — "${evaluation.reason}"`);
    }
  }

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPTS.graphQuery },
    {
      role: 'user',
      content: `User question: "${query}"\n\n${contextText}${mentionContext}`,
    },
  ];

  return {
    resolvedKey,
    nodes: subgraphNodes,
    edges: subgraphEdges,
    llmMessages,
    model,
    steps,
  };
}

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
  attachments?: QueryAttachment[],
  modelPreference?: 'auto' | 'fast' | 'powerful',
): Promise<GraphQueryResult> {
  const payload = await _buildSubgraphPayload(
    projectId, query, userId, db, adminDb, apiKeyId, contextNodeIds, attachments, modelPreference,
  );
  const llmResult = await callLLM(payload.llmMessages, payload.resolvedKey, {
    maxTokens: 2048,
    model: payload.model,
  });
  payload.steps.push('Generated AI explanation');
  return {
    nodes: payload.nodes,
    edges: payload.edges,
    explanation: llmResult.content,
    steps: payload.steps,
    usage: {
      promptTokens: llmResult.usage.promptTokens,
      completionTokens: llmResult.usage.completionTokens,
      model: llmResult.model,
    },
  };
}

/**
 * Streaming variant of querySubgraph.
 * Yields step progress events, then LLM delta events, then a final done event.
 */
export async function* querySubgraphStream(
  projectId: string,
  query: string,
  userId: string,
  db: DbClient,
  adminDb: DbClient,
  apiKeyId?: string,
  contextNodeIds?: string[],
  attachments?: QueryAttachment[],
  modelPreference?: 'auto' | 'fast' | 'powerful',
): AsyncGenerator<StreamEvent> {
  const payload = await _buildSubgraphPayload(
    projectId, query, userId, db, adminDb, apiKeyId, contextNodeIds, attachments, modelPreference,
  );

  // Emit pipeline step events before the LLM starts
  for (const step of payload.steps) {
    yield { type: 'step', text: step };
  }

  // Stream the LLM response token-by-token
  for await (const delta of callLLMStream(payload.llmMessages, payload.resolvedKey, {
    maxTokens: 2048,
    model: payload.model,
  })) {
    yield { type: 'delta', text: delta };
  }

  yield {
    type: 'done',
    nodes: payload.nodes,
    edges: payload.edges,
    steps: [...payload.steps, 'Generated AI explanation'],
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

  // Include code body for seed nodes (direct semantic matches)
  const seedsWithCode = nodes.filter((n) => n.source === 'seed' && n.code_body);
  if (seedsWithCode.length > 0) {
    const codeBlocks = seedsWithCode.slice(0, 5).map((n) => {
      const body = n.code_body!.slice(0, 1500);
      return `#### ${n.name} (\`${n.file_path}:${n.line_start ?? '?'}\`)\n\`\`\`\n${body}\n\`\`\``;
    });
    sections.push(`### Source Code (seed nodes)\n${codeBlocks.join('\n\n')}`);
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
