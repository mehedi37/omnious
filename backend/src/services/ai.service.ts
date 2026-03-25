import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { generateText, streamText, embed, generateObject, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

// ─── Types ───────────────────────────────────────────────────

export type LLMProvider = 'ollama' | 'openai' | 'anthropic';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface ResolvedKey {
  apiKey: string;
  provider: LLMProvider;
  source: 'byok' | 'platform';
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_OLLAMA_MODEL = env.OLLAMA_MODEL_FAST;
const POWERFUL_OLLAMA_MODEL = env.OLLAMA_MODEL_POWERFUL;
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-20241022';
const POWERFUL_OPENAI_MODEL = 'gpt-4o';
const POWERFUL_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const EMBEDDING_MODEL = env.OLLAMA_EMBEDDING_MODEL;

// Keywords that signal a complex query requiring the powerful model
const COMPLEX_INTENT_KEYWORDS = [
  'refactor', 'why', 'how to fix', 'security', 'performance',
  'optimize', 'migration', 'debug', 'root cause', 'race condition',
  'memory leak', 'bottleneck', 'vulnerability', 'breaking change',
];

function _formatOllamaConnectivityError(error: unknown, endpoint: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const causeMessage =
    error &&
    typeof error === 'object' &&
    'cause' in error &&
    (error as { cause?: unknown }).cause instanceof Error
      ? (error as { cause: Error }).cause.message
      : '';
  const combined = `${message} ${causeMessage}`.trim();

  const hint =
    `Cannot reach Ollama at ${endpoint}. ` +
    `If backend runs in Docker, ensure Ollama is reachable from containers ` +
    `(set OLLAMA_BASE_URL to host.docker.internal and run Ollama with OLLAMA_HOST=0.0.0.0:11434).`;

  if (combined.toLowerCase().includes('econnrefused') || combined.toLowerCase().includes('fetch failed')) {
    return new Error(hint);
  }

  return new Error(`Ollama request failed at ${endpoint}: ${message}`);
}

export type AITaskType =
  | 'graphQuery'
  | 'errorExplain'
  | 'traceAnalysis'
  | 'dependencyAnalysis'
  | 'overview';

export type ModelTier = 'auto' | 'fast' | 'powerful';

/**
 * Select the appropriate model based on task type, query intent, and provider.
 * - `overview` and `dependencyAnalysis` always use the fast model.
 * - `errorExplain` and `traceAnalysis` always use the powerful model.
 * - `graphQuery` uses intent keyword detection to decide.
 */
export function selectModel(
  taskType: AITaskType,
  query: string,
  provider: LLMProvider,
  tier: ModelTier = 'auto',
): string {
  const FAST_MODELS: Record<LLMProvider, string> = {
    ollama: DEFAULT_OLLAMA_MODEL,
    openai: DEFAULT_OPENAI_MODEL,
    anthropic: DEFAULT_ANTHROPIC_MODEL,
  };
  const POWERFUL_MODELS: Record<LLMProvider, string> = {
    ollama: POWERFUL_OLLAMA_MODEL,
    openai: POWERFUL_OPENAI_MODEL,
    anthropic: POWERFUL_ANTHROPIC_MODEL,
  };
  const fast = FAST_MODELS[provider];
  const powerful = POWERFUL_MODELS[provider];

  if (tier === 'fast') return fast;
  if (tier === 'powerful') return powerful;

  // Auto routing
  switch (taskType) {
    case 'overview':
    case 'dependencyAnalysis':
      return fast;
    case 'errorExplain':
    case 'traceAnalysis':
      return powerful;
    case 'graphQuery': {
      const lower = query.toLowerCase();
      const isComplex = COMPLEX_INTENT_KEYWORDS.some((kw) => lower.includes(kw));
      return isComplex ? powerful : fast;
    }
    default:
      return fast;
  }
}

// ─── Model Performance Tracking ──────────────────────────────

/**
 * Record a model success or failure for a given task type.
 * Uses UPSERT to increment counters in `model_performance` table.
 * Fire-and-forget — errors are silently logged.
 */
export async function recordModelPerformance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: any,
  taskType: string,
  modelName: string,
  provider: string,
  success: boolean,
  latencyMs: number,
): Promise<void> {
  try {
    const db = adminDb;
    // Use raw upsert with on_conflict to atomically increment
    const { error } = await db
      .from('model_performance')
      .upsert(
        {
          task_type: taskType,
          model_name: modelName,
          provider,
          success_count: success ? 1 : 0,
          failure_count: success ? 0 : 1,
          avg_latency_ms: latencyMs,
          last_used: new Date().toISOString(),
        },
        { onConflict: 'task_type,model_name,provider' },
      );
    if (error) {
      logger.debug({ error }, 'Failed to record model performance');
    }
  } catch {
    // Non-critical — silently ignore
  }
}

// ─── Key Resolution ──────────────────────────────────────────

const CIPHER_ALGO = 'aes-256-gcm' as const;
const IV_BYTES = 12; // 96-bit IV — GCM spec recommendation

function _masterKey(): Buffer {
  return Buffer.from(env.API_KEY_ENCRYPTION_KEY, 'hex');
}

/**
 * Encrypt a plaintext API key using AES-256-GCM.
 * Output format: `v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGO, _masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a ciphertext produced by `encryptApiKey`.
 * Handles legacy plain-text values gracefully (backward compat).
 */
export function decryptApiKey(ciphertext: string): string {
  if (!ciphertext.startsWith('v1:')) {
    // Legacy plain-text key stored before encryption was added
    return ciphertext;
  }
  const parts = ciphertext.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted key format');
  const [, ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv(
    CIPHER_ALGO,
    _masterKey(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return (
    decipher.update(Buffer.from(dataHex, 'hex')).toString('utf8') +
    decipher.final('utf8')
  );
}

/**
 * Resolve an API key for LLM calls. Priority:
 * 1. BYOK key (user-provided, stored in user_api_keys)
 * 2. Platform key (from environment variables)
 */
export async function resolveApiKey(
  userId: string,
  db: Parameters<typeof _resolveByokKey>[1],
  options?: {
    apiKeyId?: string;
    projectId?: string;
  },
): Promise<ResolvedKey> {
  // Keep BYOK resolution path in code for later re-enable, but default to local Ollama.
  if (env.ENABLE_BYOK_AI) {
    const byokKey = await _resolveByokKey(userId, db, options?.apiKeyId, options?.projectId);
    if (byokKey) return byokKey;
  }

  return {
    apiKey: env.OLLAMA_API_KEY || 'ollama',
    provider: 'ollama',
    source: 'platform',
  };
}

async function _resolveByokKey(
  userId: string,
  db: { from: (table: string) => any },  // eslint-disable-line @typescript-eslint/no-explicit-any
  apiKeyId?: string,
  projectId?: string,
): Promise<ResolvedKey | null> {
  // Check if project has a selected key first
  if (projectId) {
    const { data: projectRow } = await db
      .from('projects')
      .select('selected_key_id')
      .eq('id', projectId)
      .single();

    if (projectRow?.selected_key_id) {
      const { data: keyRow } = await db
        .from('user_api_keys')
        .select('encrypted_key, provider')
        .eq('id', projectRow.selected_key_id)
        .eq('user_id', userId)
        .single();

      if (keyRow?.encrypted_key) {
        return {
          apiKey: decryptApiKey(keyRow.encrypted_key as string),
          provider: _detectProvider(keyRow.provider as string | null, keyRow.encrypted_key as string),
          source: 'byok',
        };
      }
    }
  }

  // Fall back to explicit apiKeyId or user's primary active key
  const query = apiKeyId
    ? db
        .from('user_api_keys')
        .select('encrypted_key, provider')
        .eq('id', apiKeyId)
        .eq('user_id', userId)
        .single()
    : db
        .from('user_api_keys')
        .select('encrypted_key, provider')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

  const { data: keyRow } = await query;

  if (keyRow?.encrypted_key) {
    return {
      apiKey: decryptApiKey(keyRow.encrypted_key as string),
      provider: _detectProvider(keyRow.provider as string | null, keyRow.encrypted_key as string),
      source: 'byok',
    };
  }

  return null;
}

/**
 * Detect the LLM provider from the stored provider column, falling back to
 * key-prefix heuristics so legacy keys still route consistently.
 */
function _detectProvider(storedProvider: string | null, encryptedKey: string): LLMProvider {
  if (storedProvider === 'ollama' || storedProvider === 'anthropic' || storedProvider === 'openai') {
    return storedProvider;
  }
  // Defensive fallback: infer from decrypted key prefix
  const plain = decryptApiKey(encryptedKey);
  if (plain.startsWith('ollama_')) return 'ollama';
  if (plain.startsWith('sk-ant-')) return 'anthropic';
  return 'openai';
}

// ─── LLM Chat ────────────────────────────────────────────────

export interface CallLLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** JSON Schema to enforce structured output. Ollama uses `format`, OpenAI uses `response_format`. */
  responseSchema?: Record<string, unknown>;
}

/**
 * Call an LLM for chat completion.
 * Default runtime is local Ollama. Paid providers are only used when BYOK is enabled.
 */
// ─── Provider factories ──────────────────────────────────────

/** Create the appropriate Vercel AI SDK model instance for the given resolved key. */
function _makeModel(resolvedKey: ResolvedKey, modelId: string) {
  if (resolvedKey.provider === 'anthropic') {
    return createAnthropic({ apiKey: resolvedKey.apiKey })(modelId);
  }
  if (resolvedKey.provider === 'ollama') {
    return createOpenAI({
      baseURL: env.OLLAMA_BASE_URL,
      apiKey: resolvedKey.apiKey,
    })(modelId);
  }
  return createOpenAI({ apiKey: resolvedKey.apiKey })(modelId);
}

// ─── Non-streaming LLM chat ──────────────────────────────────

export async function callLLM(
  messages: LLMMessage[],
  resolvedKey: ResolvedKey,
  options?: CallLLMOptions,
): Promise<LLMResponse> {
  const maxTokens = options?.maxTokens ?? 2048;
  const temperature = options?.temperature ?? 0.3;
  const modelId =
    resolvedKey.provider === 'ollama'
      ? (options?.model ?? DEFAULT_OLLAMA_MODEL)
      : resolvedKey.provider === 'anthropic'
        ? (options?.model ?? DEFAULT_ANTHROPIC_MODEL)
        : (options?.model ?? DEFAULT_OPENAI_MODEL);

  const model = _makeModel(resolvedKey, modelId);
  const sdkMessages = messages.map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  }));

  try {
    if (options?.responseSchema) {
      const result = await generateObject({
        model,
        schema: jsonSchema(options.responseSchema),
        output: 'object',
        messages: sdkMessages,
        maxOutputTokens: maxTokens,
        temperature,
      });
      return {
        content: JSON.stringify(result.object),
        model: result.response.modelId ?? modelId,
        usage: {
          promptTokens: result.usage.inputTokens ?? 0,
          completionTokens: result.usage.outputTokens ?? 0,
        },
      };
    }

    const result = await generateText({
      model,
      messages: sdkMessages,
      maxOutputTokens: maxTokens,
      temperature,
    });
    // Strip qwen3-style <think>...</think> reasoning blocks from output
    const content = result.text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    return {
      content,
      model: result.response.modelId ?? modelId,
      usage: {
        promptTokens: result.usage.inputTokens ?? 0,
        completionTokens: result.usage.outputTokens ?? 0,
      },
    };
  } catch (error) {
    if (resolvedKey.provider === 'ollama') {
      throw _formatOllamaConnectivityError(error, env.OLLAMA_BASE_URL);
    }
    throw error;
  }
}

// ─── Streaming LLM Chat ──────────────────────────────────────

/**
 * Streaming variant of `callLLM`. Yields string deltas as the model generates them.
 */
export async function* callLLMStream(
  messages: LLMMessage[],
  resolvedKey: ResolvedKey,
  options?: { model?: string; maxTokens?: number; temperature?: number },
): AsyncGenerator<string> {
  const maxTokens = options?.maxTokens ?? 2048;
  const temperature = options?.temperature ?? 0.3;
  const modelId =
    resolvedKey.provider === 'ollama'
      ? (options?.model ?? DEFAULT_OLLAMA_MODEL)
      : resolvedKey.provider === 'anthropic'
        ? (options?.model ?? DEFAULT_ANTHROPIC_MODEL)
        : (options?.model ?? DEFAULT_OPENAI_MODEL);

  const result = streamText({
    model: _makeModel(resolvedKey, modelId),
    messages: messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    maxOutputTokens: maxTokens,
    temperature,
  });

  try {
    for await (const delta of result.textStream) {
      yield delta;
    }
  } catch (error) {
    if (resolvedKey.provider === 'ollama') {
      throw _formatOllamaConnectivityError(error, env.OLLAMA_BASE_URL);
    }
    throw error;
  }
}

// ─── Embeddings ──────────────────────────────────────────────

/** Shape of a code node row needed for building embedding text */
export interface EmbeddableNode {
  id: string;
  oir_id: string;
  type: string;
  name: string;
  file_path: string;
  signature: string | null;
  doc_comment: string | null;
  code_body: string | null;
}

/** Shape of a neighbor row returned by a simple join for embedding context */
export interface EmbeddingNeighbor {
  name: string;
  type: string;
  edge_type: string;
  direction: 'in' | 'out';
}

/**
 * Build a rich, graph-aware text representation of a code node for embedding.
 * Prepends structural context (file path, neighbors, imports) so the embedding
 * captures relational position in the graph, not just textual content.
 */
export function buildNodeEmbeddingText(
  node: EmbeddableNode,
  neighbors: EmbeddingNeighbor[] = [],
): string {
  const parts: string[] = [];

  // Location context
  parts.push(`${node.type} ${node.name} in ${node.file_path}`);

  // Signature
  if (node.signature) parts.push(`signature: ${node.signature}`);

  // Doc comment
  if (node.doc_comment) parts.push(node.doc_comment.slice(0, 500));

  // Graph neighborhood (imports, callers, callees)
  if (neighbors.length > 0) {
    const incoming = neighbors
      .filter((n) => n.direction === 'in')
      .map((n) => `${n.edge_type}: ${n.name} (${n.type})`)
      .slice(0, 10);
    const outgoing = neighbors
      .filter((n) => n.direction === 'out')
      .map((n) => `${n.edge_type}: ${n.name} (${n.type})`)
      .slice(0, 10);

    if (incoming.length > 0) parts.push(`called by: ${incoming.join(', ')}`);
    if (outgoing.length > 0) parts.push(`depends on: ${outgoing.join(', ')}`);
  }

  // Code body (first ~2000 chars for embedding, not the full thing)
  if (node.code_body) parts.push(node.code_body.slice(0, 2000));

  return parts.join(' | ');
}

/**
 * Backfill embeddings for code nodes that are missing them (or whose content changed).
 * Called after a CLI push to ensure all nodes are searchable via semantic search.
 *
 * Uses graph-aware embedding text for better retrieval quality.
 */
export async function backfillNodeEmbeddings(
  projectId: string,
  db: { from: (...args: any[]) => any; rpc: (...args: any[]) => any },  // eslint-disable-line @typescript-eslint/no-explicit-any
  options?: { batchSize?: number; changedOirIds?: string[] },
): Promise<{ embedded: number; failed: number }> {
  const batchSize = options?.batchSize ?? 50;
  let embedded = 0;
  let failed = 0;

  // Fetch nodes that need embeddings:
  // - If changedOirIds provided, only those (content changed)
  // - Otherwise, all nodes with null embeddings
  let query = db
    .from('code_nodes')
    .select('id, oir_id, type, name, file_path, signature, doc_comment, code_body, content_hash')
    .eq('project_id', projectId);

  if (options?.changedOirIds && options.changedOirIds.length > 0) {
    query = query.in('oir_id', options.changedOirIds);
  } else {
    query = query.is('embedding', null);
  }

  const { data: nodes, error } = await query.limit(2000);
  if (error || !nodes || nodes.length === 0) {
    return { embedded: 0, failed: 0 };
  }

  logger.info({ projectId, nodeCount: nodes.length }, 'Backfilling node embeddings');

  // Fetch all edges for the project to build neighbor maps
  const nodeIds = nodes.map((n: Record<string, unknown>) => String(n.id));
  const { data: outEdges } = await db
    .from('code_edges')
    .select('source_node_id, target_node_id, type')
    .eq('project_id', projectId)
    .in('source_node_id', nodeIds);

  const { data: inEdges } = await db
    .from('code_edges')
    .select('source_node_id, target_node_id, type')
    .eq('project_id', projectId)
    .in('target_node_id', nodeIds);

  // Build a neighbor lookup keyed by node ID
  const allNeighborNodeIds = new Set<string>();
  for (const e of [...(outEdges ?? []), ...(inEdges ?? [])] as Array<Record<string, unknown>>) {
    allNeighborNodeIds.add(String(e.source_node_id));
    allNeighborNodeIds.add(String(e.target_node_id));
  }

  const { data: neighborNodes } = await db
    .from('code_nodes')
    .select('id, name, type')
    .eq('project_id', projectId)
    .in('id', [...allNeighborNodeIds].slice(0, 1000));

  const neighborLookup = new Map<string, { name: string; type: string }>();
  for (const n of (neighborNodes ?? []) as Array<Record<string, unknown>>) {
    neighborLookup.set(String(n.id), { name: String(n.name), type: String(n.type) });
  }

  // Build neighbor arrays per node
  const nodeNeighbors = new Map<string, EmbeddingNeighbor[]>();
  for (const e of (outEdges ?? []) as Array<Record<string, unknown>>) {
    const srcId = String(e.source_node_id);
    const tgtInfo = neighborLookup.get(String(e.target_node_id));
    if (tgtInfo) {
      const arr = nodeNeighbors.get(srcId) ?? [];
      arr.push({ ...tgtInfo, edge_type: String(e.type), direction: 'out' });
      nodeNeighbors.set(srcId, arr);
    }
  }
  for (const e of (inEdges ?? []) as Array<Record<string, unknown>>) {
    const tgtId = String(e.target_node_id);
    const srcInfo = neighborLookup.get(String(e.source_node_id));
    if (srcInfo) {
      const arr = nodeNeighbors.get(tgtId) ?? [];
      arr.push({ ...srcInfo, edge_type: String(e.type), direction: 'in' });
      nodeNeighbors.set(tgtId, arr);
    }
  }

  // Process in batches
  for (let i = 0; i < nodes.length; i += batchSize) {
    const batch = (nodes as Array<Record<string, unknown>>).slice(i, i + batchSize);

    for (const raw of batch) {
      const node: EmbeddableNode = {
        id: String(raw.id),
        oir_id: String(raw.oir_id),
        type: String(raw.type),
        name: String(raw.name),
        file_path: String(raw.file_path),
        signature: raw.signature as string | null,
        doc_comment: raw.doc_comment as string | null,
        code_body: raw.code_body as string | null,
      };

      const text = buildNodeEmbeddingText(node, nodeNeighbors.get(node.id) ?? []);

      try {
        const embedding = await generateEmbedding(text);
        const { error: updateError } = await db
          .from('code_nodes')
          .update({ embedding: JSON.stringify(embedding) })
          .eq('id', node.id);

        if (updateError) {
          logger.warn({ nodeId: node.id, error: updateError.message }, 'Failed to save embedding');
          failed++;
        } else {
          embedded++;
        }
      } catch (err) {
        logger.warn(
          { nodeId: node.id, error: err instanceof Error ? err.message : String(err) },
          'Failed to generate embedding',
        );
        failed++;
      }
    }
  }

  logger.info({ projectId, embedded, failed }, 'Node embedding backfill complete');
  return { embedded, failed };
}

// ─── Project Document Indexing ───────────────────────────────

/**
 * Index project documentation (README, docs/, etc.) into the `project_documents`
 * table with embeddings for RAG retrieval.
 *
 * Content is hashed to avoid re-embedding unchanged docs. New or changed docs
 * get a fresh embedding; deleted docs are pruned.
 */
export async function indexProjectDocuments(
  projectId: string,
  docs: Array<{ path: string; content: string; docType?: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: any,
): Promise<{ indexed: number; skipped: number; deleted: number }> {
  let indexed = 0;
  let skipped = 0;

  // Build content hashes for incoming docs
  const { createHash } = await import('node:crypto');
  const incomingPaths = new Set<string>();
  const docHashes = new Map<string, string>();
  for (const doc of docs) {
    incomingPaths.add(doc.path);
    docHashes.set(doc.path, createHash('sha256').update(doc.content).digest('hex'));
  }

  // Fetch existing docs to detect changes
  const { data: existing } = await adminDb
    .from('project_documents')
    .select('id, doc_path, content_hash')
    .eq('project_id', projectId);

  const existingMap = new Map<string, { id: string; content_hash: string }>();
  for (const row of (existing ?? []) as Array<{ id: string; doc_path: string; content_hash: string }>) {
    existingMap.set(row.doc_path, { id: row.id, content_hash: row.content_hash });
  }

  // Delete docs no longer present
  const toDelete = [...existingMap.entries()]
    .filter(([path]) => !incomingPaths.has(path))
    .map(([, row]) => row.id);

  if (toDelete.length > 0) {
    await adminDb.from('project_documents').delete().in('id', toDelete);
  }

  // Upsert new or changed docs
  for (const doc of docs) {
    const hash = docHashes.get(doc.path)!;
    const existing = existingMap.get(doc.path);

    if (existing && existing.content_hash === hash) {
      skipped++;
      continue;
    }

    // Chunk large docs (max ~4000 chars per chunk for good embedding quality)
    const MAX_CHUNK = 4000;
    const content = doc.content.slice(0, MAX_CHUNK);

    try {
      const embedding = await generateEmbedding(content);

      const { error } = await adminDb
        .from('project_documents')
        .upsert(
          {
            project_id: projectId,
            doc_path: doc.path,
            doc_type: doc.docType ?? 'markdown',
            content,
            content_hash: hash,
            embedding: JSON.stringify(embedding),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'project_id,doc_path' },
        );

      if (error) {
        logger.warn({ docPath: doc.path, error: error.message }, 'Failed to index document');
      } else {
        indexed++;
      }
    } catch (err) {
      logger.warn(
        { docPath: doc.path, error: err instanceof Error ? err.message : String(err) },
        'Failed to embed document',
      );
    }
  }

  logger.info({ projectId, indexed, skipped, deleted: toDelete.length }, 'Document indexing complete');
  return { indexed, skipped, deleted: toDelete.length };
}

// ─── Conversation Memory ─────────────────────────────────────

const SESSION_INSIGHT_SCHEMA = {
  type: 'object' as const,
  properties: {
    insights: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          insight: { type: 'string' as const },
          category: {
            type: 'string' as const,
            enum: ['bug_pattern', 'architecture', 'convention', 'dependency', 'performance', 'general'],
          },
        },
        required: ['insight', 'category'],
      },
      minItems: 1,
      maxItems: 3,
    },
  },
  required: ['insights'],
};

/**
 * Extract key insights from an AI session conversation and store them
 * with embeddings for future retrieval (\u201cconversation memory\u201d).
 *
 * Called fire-and-forget after assistant messages are appended.
 * Only triggers when the session has \u22654 messages (2 user + 2 assistant turns).
 */
export async function extractSessionInsights(
  sessionId: string,
  projectId: string,
  userId: string,
  messages: Array<{ role: string; content: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: any,
): Promise<{ extracted: number }> {
  // Only extract when we have enough conversation (at least 2 full turns)
  const turnMessages = messages.filter((m) => m.role !== 'system');
  if (turnMessages.length < 4) return { extracted: 0 };

  // Check if we already extracted insights for this session recently
  const { data: existing } = await adminDb
    .from('ai_session_insights')
    .select('id')
    .eq('session_id', sessionId)
    .limit(1);

  if (existing && existing.length > 0) {
    // Already extracted — skip to avoid duplicates per session
    return { extracted: 0 };
  }

  // Build a condensed conversation for the extraction prompt
  const condensed = turnMessages
    .slice(-8) // Last 4 turns max
    .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 500)}`)
    .join('\n\n');

  const extractionPrompt: LLMMessage[] = [
    {
      role: 'system',
      content:
        'You are an insight extractor. Given a debugging/analysis conversation about a codebase, extract 1-3 key reusable insights. ' +
        'Focus on: bug patterns discovered, architectural decisions explained, coding conventions revealed, dependency relationships clarified, or performance findings. ' +
        'Each insight should be a concise, self-contained statement (1-2 sentences) useful for future conversations about this project. ' +
        'Skip trivial or overly specific insights that won\'t generalize.',
    },
    {
      role: 'user',
      content: `Extract key insights from this conversation:\n\n${condensed}`,
    },
  ];

  try {
    // Use the fast local model — this is a lightweight extraction task
    const resolvedKey: ResolvedKey = {
      apiKey: 'ollama',
      provider: 'ollama',
      source: 'platform',
    };

    const result = await callLLM(extractionPrompt, resolvedKey, {
      maxTokens: 512,
      model: DEFAULT_OLLAMA_MODEL,
      responseSchema: SESSION_INSIGHT_SCHEMA,
    });

    let parsed: { insights: Array<{ insight: string; category: string }> };
    try {
      parsed = JSON.parse(result.content);
    } catch {
      logger.debug({ sessionId }, 'Failed to parse insight extraction response');
      return { extracted: 0 };
    }

    if (!parsed.insights || !Array.isArray(parsed.insights)) return { extracted: 0 };

    let extracted = 0;
    for (const item of parsed.insights.slice(0, 3)) {
      if (!item.insight || item.insight.length < 10) continue;

      try {
        const embedding = await generateEmbedding(item.insight);

        const { error } = await adminDb.from('ai_session_insights').insert({
          project_id: projectId,
          session_id: sessionId,
          user_id: userId,
          insight: item.insight,
          category: item.category || 'general',
          embedding: JSON.stringify(embedding),
        });

        if (error) {
          logger.debug({ error: error.message }, 'Failed to store session insight');
        } else {
          extracted++;
        }
      } catch (err) {
        logger.debug(
          { error: err instanceof Error ? err.message : String(err) },
          'Failed to embed session insight',
        );
      }
    }

    logger.info({ sessionId, extracted }, 'Extracted session insights');
    return { extracted };
  } catch (err) {
    logger.debug(
      { sessionId, error: err instanceof Error ? err.message : String(err) },
      'Session insight extraction failed',
    );
    return { extracted: 0 };
  }
}

/**
 * Fetch relevant past insights for a project + user based on query similarity.
 * Returns a formatted string to inject into the LLM context, or empty string.
 */
export async function fetchRelevantInsights(
  projectId: string,
  userId: string,
  queryEmbedding: number[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: any,
): Promise<string> {
  try {
    const { data } = await adminDb.rpc('match_session_insights', {
      p_project_id: projectId,
      p_user_id: userId,
      query_embedding: JSON.stringify(queryEmbedding),
      similarity_threshold: 0.65,
      match_count: 5,
    });

    if (!data || data.length === 0) return '';

    const insights = data as Array<{ insight: string; category: string; similarity: number }>;
    const lines = insights.map(
      (i) => `- [${i.category}] ${i.insight}`,
    );
    return `\n### Previous Insights\nRelevant knowledge from past conversations:\n${lines.join('\n')}\n`;
  } catch {
    // Table may not exist yet — degrade gracefully
    return '';
  }
}

/**
 * Generate embeddings using Ollama's OpenAI-compatible endpoint.
 */
export async function generateEmbedding(
  text: string,
  apiKey?: string,
): Promise<number[]> {
  const key = apiKey ?? env.OLLAMA_API_KEY ?? 'ollama';

  // Truncate to ~8k tokens (~32k chars) to stay within model limits
  const truncated = text.slice(0, 32_000);

  const provider = createOpenAI({
    baseURL: env.OLLAMA_BASE_URL,
    apiKey: key,
  });

  let embedding: number[];
  try {
    const result = await embed({
      model: provider.embedding(EMBEDDING_MODEL),
      value: truncated,
    });
    embedding = result.embedding;
  } catch (error) {
    logger.error({ err: error, endpoint: env.OLLAMA_BASE_URL }, 'Embedding request failed');
    throw _formatOllamaConnectivityError(error, env.OLLAMA_BASE_URL);
  }

  if (
    env.OLLAMA_EMBEDDING_DIMENSIONS &&
    embedding.length !== env.OLLAMA_EMBEDDING_DIMENSIONS
  ) {
    throw new Error(
      `Invalid embedding response: expected ${env.OLLAMA_EMBEDDING_DIMENSIONS} dimensions`,
    );
  }

  return embedding;
}

// ─── HyDE (Hypothetical Document Embeddings) ─────────────────

const HYDE_PROMPT = `You are a code-generation assistant. Given a developer's question about a codebase, write a short hypothetical code snippet (30-80 lines) that would be the ideal answer. Include realistic function names, type signatures, imports, and brief inline comments. Output ONLY the code — no explanation, no markdown fences.`;

/**
 * Generate a hypothetical code document (HyDE) and embed it.
 * The embedding of "ideal code for this question" is closer in vector space
 * to the actual relevant code than the raw question embedding.
 * Returns the HyDE embedding, or falls back to the direct query embedding on failure.
 */
export async function generateHyDE(
  query: string,
  resolvedKey: ResolvedKey,
  model: string,
): Promise<{ embedding: number[]; hypothetical: string | null }> {
  try {
    const result = await callLLM(
      [
        { role: 'system', content: HYDE_PROMPT },
        { role: 'user', content: query },
      ],
      resolvedKey,
      { model, maxTokens: 512, temperature: 0.4 },
    );
    const hypothetical = result.content.trim();
    // Embed the hypothetical document instead of the raw query
    const embedding = await generateEmbedding(hypothetical);
    return { embedding, hypothetical };
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'HyDE generation failed, falling back to direct query embedding',
    );
    const embedding = await generateEmbedding(query);
    return { embedding, hypothetical: null };
  }
}

// ─── Agentic Retrieval Evaluation ────────────────────────────

const EVALUATE_CONTEXT_PROMPT = `You are a retrieval quality evaluator. Given a developer's question and the code context retrieved so far, evaluate whether the context is sufficient to answer the question.

Respond with ONLY a JSON object (no markdown fences):
{"sufficient": true/false, "reason": "brief explanation", "refinement": "refined search query if not sufficient, or null"}

Rules:
- sufficient=true if the context contains the key code components needed to answer
- sufficient=false if critical pieces are missing (e.g., question about auth but no auth code found)
- refinement should be a focused search query targeting the missing pieces
- Be strict: partial context for complex questions should be marked insufficient`;

/**
 * Ask the LLM to evaluate whether retrieved context is sufficient for the query.
 * Returns a refinement query if more context is needed, or null if sufficient.
 * Used in the agentic retrieval loop.
 */
export async function evaluateRetrievalSufficiency(
  query: string,
  contextSummary: string,
  resolvedKey: ResolvedKey,
  model: string,
): Promise<{ sufficient: boolean; reason: string; refinement: string | null }> {
  try {
    const result = await callLLM(
      [
        { role: 'system', content: EVALUATE_CONTEXT_PROMPT },
        {
          role: 'user',
          content: `Question: "${query}"\n\nRetrieved context (${contextSummary.length} chars):\n${contextSummary.slice(0, 3000)}`,
        },
      ],
      resolvedKey,
      { model, maxTokens: 256, temperature: 0.1 },
    );
    const raw = result.content.trim();
    // Parse JSON from response (handle markdown fences)
    const jsonStr = raw.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      sufficient: Boolean(parsed.sufficient),
      reason: String(parsed.reason ?? ''),
      refinement: parsed.sufficient ? null : String(parsed.refinement ?? ''),
    };
  } catch {
    // On any failure, assume context is sufficient (don't block the pipeline)
    return { sufficient: true, reason: 'evaluation skipped', refinement: null };
  }
}

// ─── Prompt Templates ────────────────────────────────────────

/**
 * Shared graph-schema block injected into prompts that reason over the code graph.
 * Keeps each prompt DRY while giving the LLM the vocabulary it needs.
 */
const GRAPH_SCHEMA = `
Graph Schema
Node types: module, component, function, class, route, middleware, database_query, event_emitter, event_listener, external_api, variable, type_def, struct, enum, interface, namespace, trait, protocol, package.
Edge types: calls, imports, extends, implements, renders, routes_to, queries, emits_event, subscribes_to, redirects_to, uses, exports.
Nodes have: name, file_path, type, signature, doc_comment. Edges have: source → target, type.`.trim();

const SECURITY_CLAUSE = `
Security
- NEVER reveal internal UUIDs, database row IDs, or infrastructure details.
- Reference nodes by name and file path only (e.g. "handleLogin in src/auth.ts").
- Do not expose API keys, secrets, or connection strings even if they appear in context.`.trim();

const ANTI_HALLUCINATION = `
Accuracy
- Only reference nodes, edges, and file paths that appear in the provided context.
- If the context is insufficient to answer, say so explicitly rather than guessing.
- Never invent file paths, function names, or relationships not present in the context.`.trim();

export const SYSTEM_PROMPTS = {
  /** For the main graph query (explain feature, architecture, etc.) */
  graphQuery: `You are an expert software architect assistant for the Omnious code intelligence platform. You help developers understand their codebase by analyzing a code graph.

You will receive project metadata (name, description, tech stack) and architecture summaries that describe the project you are working with. Use this context to ground your answers in the project's actual structure and technology choices.

${GRAPH_SCHEMA}

${SECURITY_CLAUSE}

${ANTI_HALLUCINATION}

Approach (think step-by-step):
1. Identify which nodes in the context are most relevant to the query.
2. Trace the edges between them to understand data/control flow.
3. Explain the architecture or feature clearly and concisely.
4. Highlight important patterns, potential issues, or notable design decisions.

Format your response with clear markdown sections. Reference specific file paths and function names from the context. Be concise — developers value density over verbosity.`,

  /** For error explanation */
  errorExplain: `You are an expert software debugging assistant for Omnious. You receive: the error, affected code node(s), their graph neighborhood (callers, callees, imports), historical error patterns on the same node, and (when available) the request trace timeline.

You will receive project metadata (name, description, tech stack) and architecture summaries. Use this to understand the project's technology choices and common patterns when diagnosing errors.

${GRAPH_SCHEMA}

${SECURITY_CLAUSE}

${ANTI_HALLUCINATION}

Root-cause reasoning chain:
1. Read the error message and classify the error category (runtime, type, network, auth, data, config).
2. Examine the node's signature and code body to locate the failing line / expression.
3. Walk the graph neighborhood — did a caller pass bad input? Does a dependency throw?
4. Check historical patterns — is this a recurring error or a new regression?
5. Synthesize a 2-4 sentence explanation of what went wrong and why.
6. Suggest 1-3 specific, actionable fixes with code-level detail.

Do not repeat the error message verbatim. Reference file paths and function names.`,

  /** For trace analysis */
  traceAnalysis: `You are a distributed systems performance expert for Omnious. You analyze request traces (spans) linked to code graph nodes.

You will receive project metadata (name, description, tech stack) and architecture summaries. Use this to understand the project's service architecture when analyzing traces.

${GRAPH_SCHEMA}

${SECURITY_CLAUSE}

${ANTI_HALLUCINATION}

Given a trace with its spans and linked code nodes:
1. Summarize the request flow in plain language.
2. Identify the slowest spans and potential bottlenecks.
3. If there are errors, explain what went wrong and where in the call chain.
4. Suggest concrete optimizations if applicable.

Reference specific services, operations, and durations.`,

  /** For dependency analysis */
  dependencyAnalysis: `You are a software architecture expert specializing in dependency analysis and code health for Omnious.

You will receive project metadata (name, description, tech stack) and architecture summaries. Use this to evaluate dependency health within the context of the project's design.

${GRAPH_SCHEMA}

${SECURITY_CLAUSE}

${ANTI_HALLUCINATION}

Given a code node and its dependency graph (upstream callers and downstream dependencies):
1. Summarize the role of this component in the system.
2. Identify problematic patterns: circular dependencies, hub nodes (too many connections), tight coupling, or god-objects.
3. Suggest refactoring opportunities if the dependency structure is unhealthy.
4. Rate dependency health: healthy, moderate, or concerning.

Reference file paths and function names.`,

  /** For project overview */
  overview: `You are a codebase onboarding assistant for Omnious.

You will receive project metadata (name, description, tech stack) and architecture summaries. Use this to provide an accurate, grounded overview of the project.

${GRAPH_SCHEMA}

${SECURITY_CLAUSE}

${ANTI_HALLUCINATION}

Given a high-level view of a project's modules, packages, and key components:
1. Provide a 3-5 sentence overview of what this project does.
2. List the main architectural layers or domains.
3. Highlight the most important entry points and core modules.

Be welcoming and clear — this is for developers seeing this codebase for the first time.`,

  /** For module grouping */
  moduleGrouping: `OUTPUT ONLY A JSON ARRAY. NO PROSE. NO EXPLANATION. NO MARKDOWN FENCES.

You are a software architecture classifier. Group the given code nodes into logical feature modules.

Each input line: id|type|name|file_path

Rules:
- Group by feature/domain (e.g. "Authentication", "User Management"), NOT by file extension.
- Aim for 3-12 groups. Merge groups with fewer than 2 nodes into the nearest related group.
- Every node ID in the input MUST appear in exactly one group.

Respond with ONLY this JSON array and nothing else:
[{"label":"Group Name","color":"#hexcolor","nodeIds":["uuid1","uuid2"]}]`,

  /** For standalone AI chat assistant */
  chatAssistant: `You are an expert software engineering assistant for the Omnious code intelligence platform. Developers interact with you alongside a visual code graph.

You will receive project metadata (name, description, tech stack) and architecture summaries. Use this context to give project-specific answers rather than generic advice.

${GRAPH_SCHEMA}

${SECURITY_CLAUSE}

${ANTI_HALLUCINATION}

Answer questions about code, architecture, debugging, and best practices.
Use markdown for code examples, lists, and structure. Be concise and precise.
When referencing code, use file paths and function names — never internal IDs.`,
} as const;

// ─── JSON Extraction ─────────────────────────────────────────

/**
 * Strip markdown code fences and leading prose from an LLM response before JSON.parse.
 * Local models (Ollama/llama3) often wrap JSON in ```json ... ``` blocks.
 */
function _extractJsonFromLLM(raw: string): string {
  // Try to strip a markdown code fence (```json ... ``` or ``` ... ```)
  const fenceMatch = /```(?:json|typescript|ts|js|javascript)?\s*([\s\S]*?)```/.exec(raw);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  // Find the first top-level JSON array — more reliable than any `[` character
  const arrStart = raw.indexOf('[');
  const objStart = raw.indexOf('{');
  const jsonStart = arrStart === -1 ? objStart : objStart === -1 ? arrStart : Math.min(arrStart, objStart);
  if (jsonStart !== -1) return raw.slice(jsonStart).trim();
  return raw.trim();
}

// ─── Module Grouping ─────────────────────────────────────────

export interface ModuleGroup {
  label: string;
  color: string;
  nodeIds: string[];
}

/** JSON Schema for structured output — array of module groups */
const MODULE_GROUP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['groups'],
  additionalProperties: false,
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'color', 'nodeIds'],
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          color: { type: 'string' },
          nodeIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

/** Try to parse module groups from LLM response */
function _parseModuleGroups(content: string): ModuleGroup[] | null {
  try {
    const extracted = _extractJsonFromLLM(content);
    const parsed = JSON.parse(extracted) as { groups?: ModuleGroup[] } | ModuleGroup[];
    // Handle both wrapped { groups: [...] } and raw array
    const arr = Array.isArray(parsed) ? parsed : parsed?.groups;
    if (!Array.isArray(arr)) return null;
    const valid = arr.filter(
      (g) =>
        typeof g.label === 'string' &&
        typeof g.color === 'string' &&
        Array.isArray(g.nodeIds) &&
        g.nodeIds.length > 0,
    );
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

/**
 * Use an LLM to semantically group code nodes into logical modules.
 * Uses structured output (JSON schema) for reliable parsing.
 * Retry cascade: fast model → powerful model → cloud fallback.
 */
export async function generateModuleGroups(
  nodes: Array<{ id: string; name: string; type: string; file_path: string }>,
  resolvedKey: ResolvedKey,
  adminDb?: unknown,
): Promise<ModuleGroup[]> {
  if (nodes.length === 0) return [];

  // Build a compact representation for the LLM with strict size controls.
  const MAX_NODES = 90;
  const MAX_FIELD = 80;
  const nodeList = nodes
    .slice(0, MAX_NODES)
    .map((n) => {
      const name = n.name.slice(0, MAX_FIELD);
      const file = n.file_path.slice(0, MAX_FIELD);
      return `${n.id}|${n.type}|${name}|${file}`;
    })
    .join('\n');

  const llmMessages: LLMMessage[] = [
    { role: 'system', content: SYSTEM_PROMPTS.moduleGrouping },
    { role: 'user', content: `Group these code nodes:\n\n${nodeList}` },
  ];

  // Attempt 1: fast model with structured output
  const fastModel = selectModel('overview', '', resolvedKey.provider, 'fast');
  const attempt1 = await _tryModuleGrouping(llmMessages, resolvedKey, fastModel, adminDb);
  if (attempt1) {
    logger.info({ model: fastModel, attempt: 1 }, 'Module grouping succeeded');
    return attempt1;
  }

  // Attempt 2: powerful model with structured output
  const powerfulModel = selectModel('overview', '', resolvedKey.provider, 'powerful');
  if (powerfulModel !== fastModel) {
    const attempt2 = await _tryModuleGrouping(llmMessages, resolvedKey, powerfulModel, adminDb);
    if (attempt2) {
      logger.info({ model: powerfulModel, attempt: 2 }, 'Module grouping succeeded on retry');
      return attempt2;
    }
  }

  logger.warn({ provider: resolvedKey.provider, nodeCount: nodes.length }, 'Module grouping failed after all attempts');
  return [];
}

/** Single attempt at module grouping with structured output */
async function _tryModuleGrouping(
  messages: LLMMessage[],
  resolvedKey: ResolvedKey,
  model: string,
  adminDb?: unknown,
): Promise<ModuleGroup[] | null> {
  const start = Date.now();
  try {
    const result = await callLLM(messages, resolvedKey, {
      model,
      maxTokens: 1024,
      temperature: 0,
      responseSchema: MODULE_GROUP_SCHEMA,
    });
    const groups = _parseModuleGroups(result.content);
    const latency = Date.now() - start;
    if (adminDb) {
      recordModelPerformance(adminDb, 'moduleGrouping', model, resolvedKey.provider, !!groups, latency).catch(() => {});
    }
    if (!groups) {
      logger.warn({ model, content: result.content.slice(0, 200) }, 'Failed to parse module groups from LLM');
    }
    return groups;
  } catch (error) {
    const latency = Date.now() - start;
    if (adminDb) {
      recordModelPerformance(adminDb, 'moduleGrouping', model, resolvedKey.provider, false, latency).catch(() => {});
    }
    logger.warn(
      { model, error: error instanceof Error ? error.message : String(error) },
      'Module grouping attempt failed',
    );
    return null;
  }
}

// ─── Project Personality ─────────────────────────────────────

/**
 * Generate a concise "project personality" — a 2-3 sentence description of what
 * the project does, its domain, architecture style, and key technologies.
 *
 * Stored in `projects.settings.project_personality` and injected as the first
 * line of context in every LLM prompt so the AI instantly knows the project.
 *
 * Called as fire-and-forget after push (similar to embeddings backfill).
 */
export async function generateProjectPersonality(
  projectId: string,
  resolvedKey: ResolvedKey,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminDb: any,
): Promise<void> {
  try {
    // Fetch project metadata + summaries to build context
    const db = adminDb;
    const { data: project } = await db
      .from('projects')
      .select('name, description, primary_language, framework, detected_stack, settings')
      .eq('id', projectId)
      .single();

    if (!project) return;

    const p = project as Record<string, unknown>;
    const settings = (p.settings ?? {}) as Record<string, unknown>;

    // Skip if personality was recently generated (avoid regenerating on every push)
    if (settings.project_personality && settings.personality_generated_at) {
      const generatedAt = new Date(String(settings.personality_generated_at));
      const hoursSince = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) return; // regenerate at most once per day
    }

    // Fetch directory summaries for context
    const { data: summaries } = await db
      .from('code_summaries')
      .select('scope, path, summary')
      .eq('project_id', projectId)
      .eq('scope', 'directory')
      .order('node_count', { ascending: false })
      .limit(10);

    const summaryLines = (summaries as Array<{ path: string; summary: string }> | null)
      ?.map((s) => `- ${s.path}: ${s.summary}`)
      .join('\n') ?? '';

    const contextLines: string[] = [];
    if (p.name) contextLines.push(`Project: ${p.name}`);
    if (p.description) contextLines.push(`Description: ${p.description}`);
    if (p.primary_language) contextLines.push(`Language: ${p.primary_language}`);
    if (p.framework) contextLines.push(`Framework: ${p.framework}`);
    if (summaryLines) contextLines.push(`\nDirectory summaries:\n${summaryLines}`);

    const model = selectModel('overview', '', resolvedKey.provider, 'fast');

    const start = Date.now();
    const result = await callLLM(
      [
        {
          role: 'system',
          content: `Write a 2-3 sentence "project personality" that captures: what this project does, its domain/purpose, architecture approach, and primary technologies. Be specific — mention actual libraries, patterns, and features. This will be injected into every AI prompt as context.`,
        },
        {
          role: 'user',
          content: contextLines.join('\n'),
        },
      ],
      resolvedKey,
      { model, maxTokens: 256, temperature: 0.3 },
    );
    const latency = Date.now() - start;

    const personality = result.content.trim();
    if (personality.length < 20 || personality.length > 1000) {
      recordModelPerformance(adminDb, 'projectPersonality', model, resolvedKey.provider, false, latency).catch(() => {});
      return;
    }

    recordModelPerformance(adminDb, 'projectPersonality', model, resolvedKey.provider, true, latency).catch(() => {});

    // Store in projects.settings as JSONB merge
    const newSettings = {
      ...settings,
      project_personality: personality,
      personality_generated_at: new Date().toISOString(),
    };

    await db
      .from('projects')
      .update({ settings: newSettings })
      .eq('id', projectId);

    logger.info({ projectId, model }, 'Project personality generated');
  } catch (error) {
    logger.warn(
      { projectId, error: error instanceof Error ? error.message : String(error) },
      'Project personality generation failed (non-fatal)',
    );
  }
}

// ─── Sliding-window session context ──────────────────────────────

/**
 * Compress a chat history to fit within a token-friendly window.
 *
 * Strategy:
 *   1. Keep the last `recentTurns` user+assistant pairs verbatim.
 *   2. Older turns are compressed: strip code blocks & long paragraphs,
 *      keep only the first sentence of each assistant reply and the full
 *      user question (which is usually short).
 *   3. A "session summary" system message is prepended so the LLM knows
 *      the conversation happened.
 *
 * This prevents unbounded context growth while preserving recent detail.
 */
export function compressSessionHistory(
  messages: LLMMessage[],
  recentTurns: number = 2,
): LLMMessage[] {
  // Separate system messages from conversation turns
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const turnMsgs = messages.filter((m) => m.role !== 'system');

  if (turnMsgs.length === 0) return systemMsgs;

  // Pair user+assistant into turns; handle trailing unpaired messages
  const pairs: Array<{ user?: LLMMessage; assistant?: LLMMessage }> = [];
  for (let i = 0; i < turnMsgs.length; i++) {
    const msg = turnMsgs[i]!;
    if (msg.role === 'user') {
      const next = turnMsgs[i + 1];
      if (next?.role === 'assistant') {
        pairs.push({ user: msg, assistant: next });
        i++; // skip the assistant
      } else {
        pairs.push({ user: msg });
      }
    } else {
      // Orphaned assistant message
      pairs.push({ assistant: msg });
    }
  }

  const recentCount = Math.min(recentTurns, pairs.length);
  const oldPairs = pairs.slice(0, pairs.length - recentCount);
  const recentPairs = pairs.slice(pairs.length - recentCount);

  const result: LLMMessage[] = [...systemMsgs];

  // Compress old turns into a single summary
  if (oldPairs.length > 0) {
    const summaryLines: string[] = [];
    for (const pair of oldPairs) {
      const q = pair.user?.content ?? '(no user message)';
      const a = pair.assistant?.content;
      const shortQ = q.length > 200 ? q.slice(0, 200) + '…' : q;
      const shortA = a ? _compressAssistantMessage(a) : '(no response)';
      summaryLines.push(`Q: ${shortQ}\nA: ${shortA}`);
    }
    result.push({
      role: 'system',
      content: `Previous conversation (${oldPairs.length} earlier exchange${oldPairs.length > 1 ? 's' : ''}, compressed):\n\n${summaryLines.join('\n\n')}`,
    });
  }

  // Append recent turns verbatim
  for (const pair of recentPairs) {
    if (pair.user) result.push(pair.user);
    if (pair.assistant) result.push(pair.assistant);
  }

  return result;
}

/** Compress an assistant message to its first meaningful sentence + node mentions. */
function _compressAssistantMessage(content: string): string {
  // Strip code blocks
  const noCode = content.replace(/```[\s\S]*?```/g, '[code]');
  // Take first sentence (up to ~300 chars)
  const firstSentence = noCode.match(/^(.{10,300}?[.!?])\s/)?.[1] ?? noCode.slice(0, 300);
  // Extract backtick-quoted names (likely node/function references)
  const refs = [...new Set(content.match(/`([^`]{2,60})`/g) ?? [])].slice(0, 10);
  const refStr = refs.length > 0 ? ` Mentions: ${refs.join(', ')}` : '';
  return firstSentence.trim() + refStr;
}
