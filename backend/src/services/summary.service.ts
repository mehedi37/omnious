import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';
import {
  callLLM,
  type LLMMessage,
  type ResolvedKey,
} from './ai.service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (...args: any[]) => any; rpc: (...args: any[]) => any };

interface NodeRow {
  name: string;
  type: string;
  file_path: string;
  signature: string | null;
  doc_comment: string | null;
  content_hash: string;
}

const SUMMARY_PROMPT = `You are a code documentation assistant. Given a list of code symbols (functions, classes, components, etc.) that belong to a specific directory or file, write a 1-3 sentence summary describing what this code does.

Rules:
- Be concise and specific
- Focus on the purpose and responsibility of the code
- Mention key patterns (API routes, data access, UI components, etc.)
- Do NOT list individual functions — summarize the overall purpose
- Output ONLY the summary text, no markdown headers or formatting`;

/**
 * Generate hierarchical code summaries for a project.
 * Creates directory-level and file-level natural language summaries.
 * Called after push to keep summaries fresh.
 */
export async function generateCodeSummaries(
  projectId: string,
  resolvedKey: ResolvedKey,
  db: DbClient,
  model: string,
): Promise<{ created: number; updated: number; skipped: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Fetch all nodes for the project
  const { data: nodes, error } = await db
    .from('code_nodes')
    .select('name, type, file_path, signature, doc_comment, content_hash')
    .eq('project_id', projectId)
    .limit(5000);

  if (error || !nodes || nodes.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const typedNodes = nodes as NodeRow[];

  // Group nodes by file path
  const byFile = new Map<string, NodeRow[]>();
  for (const n of typedNodes) {
    const arr = byFile.get(n.file_path) ?? [];
    arr.push(n);
    byFile.set(n.file_path, arr);
  }

  // Group files by directory
  const byDir = new Map<string, NodeRow[]>();
  for (const [filePath, fileNodes] of byFile) {
    const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '/';
    const arr = byDir.get(dir) ?? [];
    arr.push(...fileNodes);
    byDir.set(dir, arr);
  }

  // Fetch existing summaries for cache comparison
  const { data: existing } = await db
    .from('code_summaries')
    .select('scope, path, content_hash')
    .eq('project_id', projectId);

  const existingMap = new Map<string, string>();
  for (const s of (existing ?? []) as Array<{ scope: string; path: string; content_hash: string }>) {
    existingMap.set(`${s.scope}:${s.path}`, s.content_hash);
  }

  // Generate file-level summaries (for files with 2+ nodes)
  for (const [filePath, fileNodes] of byFile) {
    if (fileNodes.length < 2) continue;

    const contentHash = _hashNodeGroup(fileNodes);
    const cacheKey = `file:${filePath}`;

    if (existingMap.get(cacheKey) === contentHash) {
      skipped++;
      continue;
    }

    try {
      const summary = await _generateSummary(filePath, fileNodes, resolvedKey, model);
      const result = await _upsertSummary(db, projectId, 'file', filePath, summary, fileNodes.length, contentHash);
      if (result === 'created') created++;
      else updated++;
    } catch (err) {
      logger.warn({ filePath, error: err instanceof Error ? err.message : String(err) }, 'File summary generation failed');
    }
  }

  // Generate directory-level summaries (for dirs with 3+ nodes)
  for (const [dir, dirNodes] of byDir) {
    if (dirNodes.length < 3) continue;

    const contentHash = _hashNodeGroup(dirNodes);
    const cacheKey = `directory:${dir}`;

    if (existingMap.get(cacheKey) === contentHash) {
      skipped++;
      continue;
    }

    try {
      const summary = await _generateSummary(dir, dirNodes, resolvedKey, model);
      const result = await _upsertSummary(db, projectId, 'directory', dir, summary, dirNodes.length, contentHash);
      if (result === 'created') created++;
      else updated++;
    } catch (err) {
      logger.warn({ dir, error: err instanceof Error ? err.message : String(err) }, 'Directory summary generation failed');
    }
  }

  logger.info({ projectId, created, updated, skipped }, 'Code summary generation complete');
  return { created, updated, skipped };
}

/**
 * Fetch all summaries for a project (used by frontend tree sidebar tooltips).
 */
export async function getCodeSummaries(
  projectId: string,
  db: DbClient,
): Promise<Array<{ scope: string; path: string; summary: string; node_count: number }>> {
  const { data, error } = await db
    .from('code_summaries')
    .select('scope, path, summary, node_count')
    .eq('project_id', projectId)
    .order('path');

  if (error) {
    logger.warn({ projectId, error: error.message }, 'Failed to fetch code summaries');
    return [];
  }

  return (data ?? []) as Array<{ scope: string; path: string; summary: string; node_count: number }>;
}

// ─── Internal Helpers ────────────────────────────────────────

function _hashNodeGroup(nodes: NodeRow[]): string {
  const sorted = nodes
    .map((n) => n.content_hash)
    .sort()
    .join(':');
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 32);
}

async function _generateSummary(
  path: string,
  nodes: NodeRow[],
  resolvedKey: ResolvedKey,
  model: string,
): Promise<string> {
  const nodeList = nodes.slice(0, 30).map((n) => {
    const sig = n.signature ? ` — ${n.signature}` : '';
    const doc = n.doc_comment ? ` — ${n.doc_comment.slice(0, 80)}` : '';
    return `  ${n.type}: ${n.name}${sig}${doc}`;
  }).join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: SUMMARY_PROMPT },
    { role: 'user', content: `Summarize the code in \`${path}\`:\n\n${nodeList}` },
  ];

  const result = await callLLM(messages, resolvedKey, {
    model,
    maxTokens: 256,
    temperature: 0.2,
  });

  return result.content.trim();
}

async function _upsertSummary(
  db: DbClient,
  projectId: string,
  scope: string,
  path: string,
  summary: string,
  nodeCount: number,
  contentHash: string,
): Promise<'created' | 'updated'> {
  const { data: existing } = await db
    .from('code_summaries')
    .select('id')
    .eq('project_id', projectId)
    .eq('scope', scope)
    .eq('path', path)
    .single();

  if (existing) {
    await db
      .from('code_summaries')
      .update({ summary, node_count: nodeCount, content_hash: contentHash })
      .eq('id', existing.id);
    return 'updated';
  }

  await db
    .from('code_summaries')
    .insert({
      project_id: projectId,
      scope,
      path,
      summary,
      node_count: nodeCount,
      content_hash: contentHash,
    });
  return 'created';
}
