import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

// ─── Types ───────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic' | 'groq';

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

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const ANTHROPIC_CHAT_URL = 'https://api.anthropic.com/v1/messages';
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-haiku-20241022';
const POWERFUL_OPENAI_MODEL = 'gpt-4o';
const POWERFUL_ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant';
const POWERFUL_GROQ_MODEL = 'llama-3.3-70b-versatile';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Keywords that signal a complex query requiring the powerful model
const COMPLEX_INTENT_KEYWORDS = [
  'refactor', 'why', 'how to fix', 'security', 'performance',
  'optimize', 'migration', 'debug', 'root cause', 'race condition',
  'memory leak', 'bottleneck', 'vulnerability', 'breaking change',
];

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
    openai: DEFAULT_OPENAI_MODEL,
    anthropic: DEFAULT_ANTHROPIC_MODEL,
    groq: DEFAULT_GROQ_MODEL,
  };
  const POWERFUL_MODELS: Record<LLMProvider, string> = {
    openai: POWERFUL_OPENAI_MODEL,
    anthropic: POWERFUL_ANTHROPIC_MODEL,
    groq: POWERFUL_GROQ_MODEL,
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
  // Try BYOK first (explicit key ID takes precedence over project selection)
  const byokKey = await _resolveByokKey(userId, db, options?.apiKeyId, options?.projectId);
  if (byokKey) return byokKey;

  // Fall back to platform key
  if (env.OPENAI_API_KEY) {
    return { apiKey: env.OPENAI_API_KEY, provider: 'openai', source: 'platform' };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { apiKey: env.ANTHROPIC_API_KEY, provider: 'anthropic', source: 'platform' };
  }

  throw new Error(
    'No API key available. Add an OpenAI, Anthropic, or Groq key in Settings → AI Keys, or configure a platform key.',
  );
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
          provider: (keyRow.provider as LLMProvider) ?? 'openai',
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
      provider: (keyRow.provider as LLMProvider) ?? 'openai',
      source: 'byok',
    };
  }

  return null;
}

// ─── LLM Chat ────────────────────────────────────────────────

/**
 * Call an LLM for chat completion. Supports OpenAI + Anthropic.
 */
export async function callLLM(
  messages: LLMMessage[],
  resolvedKey: ResolvedKey,
  options?: { model?: string; maxTokens?: number; temperature?: number },
): Promise<LLMResponse> {
  const maxTokens = options?.maxTokens ?? 2048;
  const temperature = options?.temperature ?? 0.3;

  if (resolvedKey.provider === 'anthropic') {
    return _callAnthropic(messages, resolvedKey.apiKey, {
      model: options?.model ?? DEFAULT_ANTHROPIC_MODEL,
      maxTokens,
      temperature,
    });
  }

  if (resolvedKey.provider === 'groq') {
    return _callOpenAICompatible(GROQ_CHAT_URL, 'Groq', messages, resolvedKey.apiKey, {
      model: options?.model ?? DEFAULT_GROQ_MODEL,
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

/** Shared handler for OpenAI-compatible APIs (OpenAI, Groq, etc.) */
async function _callOpenAICompatible(
  baseUrl: string,
  providerLabel: string,
  messages: LLMMessage[],
  apiKey: string,
  opts: { model: string; maxTokens: number; temperature: number },
): Promise<LLMResponse> {
  const resp = await fetch(baseUrl, {
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

// ─── Embeddings ──────────────────────────────────────────────

/**
 * Generate a 1536-dim embedding using OpenAI text-embedding-3-small.
 * Uses platform key by default (embeddings are server-side only).
 */
export async function generateEmbedding(
  text: string,
  apiKey?: string,
): Promise<number[]> {
  const key = apiKey ?? env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('OPENAI_API_KEY is required for embedding generation');
  }

  // Truncate to ~8k tokens (~32k chars) to stay within model limits
  const truncated = text.slice(0, 32_000);

  const resp = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncated,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    logger.warn({ status: resp.status, body: errText.slice(0, 300) }, 'Embedding API error');
    throw new Error(`Embedding API error ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const body = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  const embedding = body.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Invalid embedding response: expected ${EMBEDDING_DIMENSIONS} dimensions`);
  }

  return embedding;
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
} as const;

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

  // Build a compact representation for the LLM
  const nodeList = nodes
    .slice(0, 200) // Cap at 200 nodes to stay within token limits
    .map((n) => `${n.id}|${n.type}|${n.name}|${n.file_path}`)
    .join('\n');

  const model = selectModel('overview', '', resolvedKey.provider, 'fast');

  const result = await callLLM(
    [
      { role: 'system', content: SYSTEM_PROMPTS.moduleGrouping },
      { role: 'user', content: `Group these code nodes:\n\n${nodeList}` },
    ],
    resolvedKey,
    { model, maxTokens: 2048, temperature: 0.2 },
  );

  try {
    const parsed = JSON.parse(result.content) as ModuleGroup[];
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
