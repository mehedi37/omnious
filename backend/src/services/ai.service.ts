import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
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

function _normalizeOpenAIBase(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

const OLLAMA_OPENAI_BASE = _normalizeOpenAIBase(env.OLLAMA_BASE_URL);
const OLLAMA_CHAT_URL = `${OLLAMA_OPENAI_BASE}/chat/completions`;
const OLLAMA_EMBED_URL = `${OLLAMA_OPENAI_BASE}/embeddings`;

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_CHAT_URL = 'https://api.anthropic.com/v1/messages';

const DEFAULT_OLLAMA_MODEL = env.OLLAMA_MODEL;
const POWERFUL_OLLAMA_MODEL = env.OLLAMA_MODEL;
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

/**
 * Call an LLM for chat completion.
 * Default runtime is local Ollama. Paid providers are only used when BYOK is enabled.
 */
export async function callLLM(
  messages: LLMMessage[],
  resolvedKey: ResolvedKey,
  options?: { model?: string; maxTokens?: number; temperature?: number },
): Promise<LLMResponse> {
  const maxTokens = options?.maxTokens ?? 2048;
  const temperature = options?.temperature ?? 0.3;

  if (resolvedKey.provider === 'ollama') {
    return _callOpenAICompatible(OLLAMA_CHAT_URL, 'Ollama', messages, resolvedKey.apiKey, {
      model: options?.model ?? DEFAULT_OLLAMA_MODEL,
      maxTokens,
      temperature,
    });
  }

  if (resolvedKey.provider === 'anthropic') {
    return _callAnthropic(messages, resolvedKey.apiKey, {
      model: options?.model ?? DEFAULT_ANTHROPIC_MODEL,
      maxTokens,
      temperature,
    });
  }

  return _callOpenAI(messages, resolvedKey.apiKey, {
    model: options?.model ?? DEFAULT_OPENAI_MODEL,
    maxTokens,
    temperature,
  });
}

async function _callOpenAI(
  messages: LLMMessage[],
  apiKey: string,
  opts: { model: string; maxTokens: number; temperature: number },
): Promise<LLMResponse> {
  return _callOpenAICompatible(OPENAI_CHAT_URL, 'OpenAI', messages, apiKey, opts);
}

/** Shared handler for OpenAI-compatible APIs (Ollama, OpenAI, etc.) */
async function _callOpenAICompatible(
  baseUrl: string,
  providerLabel: string,
  messages: LLMMessage[],
  apiKey: string,
  opts: { model: string; maxTokens: number; temperature: number },
): Promise<LLMResponse> {
  let resp: Response;
  try {
    resp = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        messages,
      }),
    });
  } catch (error) {
    if (providerLabel === 'Ollama') {
      logger.error({ err: error, endpoint: baseUrl }, 'Ollama request failed');
      throw _formatOllamaConnectivityError(error, baseUrl);
    }
    throw error;
  }

  if (!resp.ok) {
    const errText = await resp.text();
    logger.warn({ status: resp.status, body: errText.slice(0, 300) }, `${providerLabel} API error`);
    throw new Error(`${providerLabel} API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const body = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };

  return {
    content: body.choices?.[0]?.message?.content ?? '',
    model: body.model ?? opts.model,
    usage: {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      completionTokens: body.usage?.completion_tokens ?? 0,
    },
  };
}

async function _callAnthropic(
  messages: LLMMessage[],
  apiKey: string,
  opts: { model: string; maxTokens: number; temperature: number },
): Promise<LLMResponse> {
  // Extract system message for Anthropic's separate system parameter
  const systemMsg = messages.find((m) => m.role === 'system')?.content;
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const resp = await fetch(ANTHROPIC_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(systemMsg ? { system: systemMsg } : {}),
      messages: chatMessages,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    logger.warn({ status: resp.status, body: errText.slice(0, 300) }, 'Anthropic API error');
    throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const body = (await resp.json()) as {
    content: Array<{ text: string }>;
    usage?: { input_tokens: number; output_tokens: number };
    model: string;
  };

  return {
    content: body.content?.[0]?.text ?? '',
    model: body.model ?? opts.model,
    usage: {
      promptTokens: body.usage?.input_tokens ?? 0,
      completionTokens: body.usage?.output_tokens ?? 0,
    },
  };
}

// ─── Streaming LLM Chat ──────────────────────────────────────

/**
 * Streaming variant of `callLLM`. Yields string deltas as the model generates them.
 * Delegates to provider-specific stream helpers below.
 */
export async function* callLLMStream(
  messages: LLMMessage[],
  resolvedKey: ResolvedKey,
  options?: { model?: string; maxTokens?: number; temperature?: number },
): AsyncGenerator<string> {
  const maxTokens = options?.maxTokens ?? 2048;
  const temperature = options?.temperature ?? 0.3;

  if (resolvedKey.provider === 'ollama') {
    yield* _callOpenAICompatibleStream(OLLAMA_CHAT_URL, 'Ollama', messages, resolvedKey.apiKey, {
      model: options?.model ?? DEFAULT_OLLAMA_MODEL,
      maxTokens,
      temperature,
    });
    return;
  }

  if (resolvedKey.provider === 'anthropic') {
    yield* _callAnthropicStream(messages, resolvedKey.apiKey, {
      model: options?.model ?? DEFAULT_ANTHROPIC_MODEL,
      maxTokens,
      temperature,
    });
    return;
  }

  yield* _callOpenAICompatibleStream(OPENAI_CHAT_URL, 'OpenAI', messages, resolvedKey.apiKey, {
    model: options?.model ?? DEFAULT_OPENAI_MODEL,
    maxTokens,
    temperature,
  });
}

/** Streaming handler for OpenAI-compatible APIs (Ollama, OpenAI, etc.) */
async function* _callOpenAICompatibleStream(
  baseUrl: string,
  providerLabel: string,
  messages: LLMMessage[],
  apiKey: string,
  opts: { model: string; maxTokens: number; temperature: number },
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let resp: Response;
  try {
    resp = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (providerLabel === 'Ollama') {
      throw _formatOllamaConnectivityError(error, baseUrl);
    }
    throw error;
  }

  if (!resp.ok) {
    clearTimeout(timeout);
    const errText = await resp.text();
    logger.warn({ status: resp.status, body: errText.slice(0, 300) }, `${providerLabel} stream API error`);
    throw new Error(`${providerLabel} API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // Ignore malformed SSE JSON lines
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

/** Streaming handler for Anthropic's Messages API. */
async function* _callAnthropicStream(
  messages: LLMMessage[],
  apiKey: string,
  opts: { model: string; maxTokens: number; temperature: number },
): AsyncGenerator<string> {
  const systemMsg = messages.find((m) => m.role === 'system')?.content;
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages: chatMessages,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }

  if (!resp.ok) {
    clearTimeout(timeout);
    const errText = await resp.text();
    logger.warn({ status: resp.status, body: errText.slice(0, 300) }, 'Anthropic stream API error');
    throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    let eventType = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (eventType === 'content_block_delta') {
            try {
              const chunk = JSON.parse(data) as { delta?: { type?: string; text?: string } };
              if (chunk.delta?.type === 'text_delta' && chunk.delta.text) {
                yield chunk.delta.text;
              }
            } catch {
              // Ignore malformed SSE JSON lines
            }
          }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
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

  let resp: Response;
  try {
    resp = await fetch(OLLAMA_EMBED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncated,
        ...(env.OLLAMA_EMBEDDING_DIMENSIONS
          ? { dimensions: env.OLLAMA_EMBEDDING_DIMENSIONS }
          : {}),
      }),
    });
  } catch (error) {
    logger.error({ err: error, endpoint: OLLAMA_EMBED_URL }, 'Embedding request failed');
    throw _formatOllamaConnectivityError(error, OLLAMA_EMBED_URL);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    logger.warn({ status: resp.status, body: errText.slice(0, 300) }, 'Embedding API error');
    throw new Error(`Embedding API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const body = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  const embedding = body.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Invalid embedding response from Ollama embeddings API');
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

export const SYSTEM_PROMPTS = {
  /** For the main graph query (explain feature, architecture, etc.) */
  graphQuery: `You are an expert software architect assistant for the Omnious code intelligence platform. You help developers understand their codebase by analyzing code graph data.

When the user asks about their codebase, you receive relevant code nodes, their relationships (edges), and metadata. Your job is to:
1. Explain the relevant architecture or feature clearly and concisely.
2. Identify key components and how they connect.
3. Highlight important patterns, potential issues, or notable design decisions.

Format your response with clear sections. Use markdown. Reference specific file paths and function names from the context. Be concise — developers value density over verbosity.`,

  /** For error explanation */
  errorExplain: `You are an expert software debugging assistant. You are given rich context including the error, affected code, its graph neighborhood, error patterns on the same node, and (when available) the request trace timeline.

Analyze the error and:
1. Explain what went wrong in 2-4 sentences.
2. Identify the root cause, considering the graph context and error patterns.
3. Suggest 1-3 specific, actionable fixes.

Be concise, specific, and actionable. Reference file paths and function names from the context when relevant. Do not repeat the error message verbatim.`,

  /** For trace analysis */
  traceAnalysis: `You are a distributed systems performance expert. You analyze request traces (spans) to help developers understand request flow, identify bottlenecks, and debug failures.

Given a trace with its spans and linked code nodes:
1. Summarize the request flow in plain language.
2. Identify the slowest parts and potential bottlenecks.
3. If there are errors, explain what went wrong and where.
4. Suggest concrete optimizations if applicable.

Be concise and reference specific services, operations, and durations.`,

  /** For dependency analysis */
  dependencyAnalysis: `You are a software architecture expert specializing in dependency analysis and code health. Given a code node and its dependency graph (upstream callers and downstream dependencies):

1. Summarize the role of this component in the system.
2. Identify problematic patterns: circular dependencies, hub nodes (too many connections), or tight coupling.
3. Suggest refactoring opportunities if the dependency structure is unhealthy.
4. Rate dependency health: healthy, moderate, or concerning.

Be specific — reference file paths and function names.`,

  /** For project overview */
  overview: `You are a codebase onboarding assistant. Given a high-level view of a project's modules, packages, and key components:

1. Provide a 3-5 sentence overview of what this project does.
2. List the main architectural layers or domains.
3. Highlight the most important entry points and core modules.

Be welcoming and clear — this is for developers seeing this codebase for the first time.`,

  /** For module grouping */
  moduleGrouping: `You are a software architecture expert. Given a list of code nodes (functions, classes, modules) with their file paths and types, group them into logical semantic modules.

Rules:
1. Group by feature/domain (e.g., "Authentication", "User Management", "Data Access"), NOT by file extension or directory alone.
2. Each group needs: a short label (2-4 words), a color hex code, and the list of node IDs belonging to it.
3. Aim for 3-12 groups. Merge tiny groups (<2 nodes) into the nearest related group.
4. Return ONLY valid JSON, no markdown fences.

Output format:
[{"label":"Group Name","color":"#hex","nodeIds":["id1","id2"]}]`,

  /** For standalone AI chat assistant */
  chatAssistant: `You are an expert software engineering assistant for the Omnious platform.
Answer questions about code, architecture, debugging, and best practices.
Use markdown for code examples, lists, and structure. Be concise and precise.
When referencing code, use file paths and function names where available.`,
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
  // Fall back: find first JSON array or object, discarding any leading prose
  const jsonStart = raw.search(/[\[{]/);
  if (jsonStart !== -1) return raw.slice(jsonStart).trim();
  return raw.trim();
}

// ─── Module Grouping ─────────────────────────────────────────

export interface ModuleGroup {
  label: string;
  color: string;
  nodeIds: string[];
}

/**
 * Use an LLM to semantically group code nodes into logical modules.
 * Takes the project's nodes and returns an array of groups.
 */
export async function generateModuleGroups(
  nodes: Array<{ id: string; name: string; type: string; file_path: string }>,
  resolvedKey: ResolvedKey,
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

  const model = selectModel('overview', '', resolvedKey.provider, 'fast');

  let result;
  try {
    result = await callLLM(
      [
        { role: 'system', content: SYSTEM_PROMPTS.moduleGrouping },
        { role: 'user', content: `Group these code nodes:\n\n${nodeList}` },
      ],
      resolvedKey,
      { model, maxTokens: 1024, temperature: 0.2 },
    );
  } catch (error) {
    logger.warn(
      {
        provider: resolvedKey.provider,
        nodeCount: nodes.length,
        error: error instanceof Error ? error.message : String(error),
      },
      'Module grouping skipped due to LLM error',
    );
    return [];
  }

  try {
    const parsed = JSON.parse(_extractJsonFromLLM(result.content)) as ModuleGroup[];
    if (!Array.isArray(parsed)) return [];
    // Validate structure
    return parsed.filter(
      (g) =>
        typeof g.label === 'string' &&
        typeof g.color === 'string' &&
        Array.isArray(g.nodeIds) &&
        g.nodeIds.length > 0,
    );
  } catch {
    logger.warn({ content: result.content.slice(0, 200) }, 'Failed to parse module groups from LLM');
    return [];
  }
}
