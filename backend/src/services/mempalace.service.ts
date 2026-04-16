/**
 * mempalace.service.ts
 *
 * Server-side wrapper for the MemPalace AI memory system.
 * Calls the `mempalace` CLI and Python API via subprocess.
 *
 * Architecture decision: one palace wing per Omnious project.
 * Palace data lives at ${MEMPALACE_DATA_DIR}/<projectId>/palace/
 * Wing name:  wing_<project.slug>
 *
 * Security: all subprocess calls use spawn() with explicit argv arrays
 * (never shell: true) to prevent shell injection.
 *
 * Docs: https://github.com/milla-jovovich/mempalace
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// ─── Types ───────────────────────────────────────────────────

export interface MemSearchResult {
  wing: string;
  hall: string;
  room: string;
  content: string;
  score: number;
}

export interface KGTriple {
  subject: string;
  relation: string;
  object: string;
  validFrom?: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function palacePath(projectId: string): string {
  return join(env.MEMPALACE_DATA_DIR, projectId, 'palace');
}

function wingName(slug: string): string {
  // Sanitize slug to safe characters for wing name
  return `wing_${slug.replace(/[^a-z0-9-]/g, '_')}`;
}

/**
 * Spawn a process and collect stdout/stderr as a string.
 * Rejects if the process exits with a non-zero code or the timeout fires.
 * NEVER uses `shell: true` — all args are explicit argv entries.
 */
async function runProcess(
  bin: string,
  args: string[],
  options: { timeoutMs?: number; stdinData?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      shell: false, // shell injection prevention
      timeout: options.timeoutMs ?? 60_000,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    if (options.stdinData) {
      proc.stdin.end(options.stdinData, 'utf8');
    }

    proc.on('error', (err) => reject(err));

    proc.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        logger.debug({ bin, args, code, stderr: err.slice(0, 500) }, 'mempalace subprocess failed');
        reject(new Error(`Process exited ${code}: ${err.slice(0, 300)}`));
      } else {
        resolve(out);
      }
    });
  });
}

/**
 * Run a Python one-liner via the system python3.
 * Input/output are JSON-encoded through stdin/stdout.
 *
 * The `script` template receives serialized `inputJson` via
 * `import json, sys; data = json.load(sys.stdin); ...`
 * and must write a JSON-serializable result to stdout.
 */
async function runPython(script: string, inputData: unknown): Promise<unknown> {
  const inputJson = JSON.stringify(inputData);
  const out = await runProcess(
    'python3',
    ['-c', script],
    { stdinData: inputJson, timeoutMs: 30_000 },
  );
  return JSON.parse(out.trim() || 'null');
}

// ─── Python bridge scripts ────────────────────────────────────
// Inline Python that the Node service passes to python3 -c "..."
// All receive JSON from stdin, write JSON to stdout.

const PY_ADD_DRAWER = `
import sys, json
from mempalace.searcher import add_drawer
data = json.load(sys.stdin)
add_drawer(
    content=data['content'],
    wing=data['wing'],
    hall=data.get('hall', 'hall_events'),
    room=data.get('room', 'room_sessions'),
    palace_path=data['palace_path'],
)
print('{"ok": true}')
`;

const PY_KG_ADD = `
import sys, json
from mempalace.knowledge_graph import KnowledgeGraph
data = json.load(sys.stdin)
kg = KnowledgeGraph(palace_path=data['palace_path'])
kg.add_triple(
    data['subject'], data['relation'], data['object'],
    valid_from=data.get('valid_from'),
)
print('{"ok": true}')
`;

const PY_KG_QUERY = `
import sys, json
from mempalace.knowledge_graph import KnowledgeGraph
data = json.load(sys.stdin)
kg = KnowledgeGraph(palace_path=data['palace_path'])
result = kg.query_entity(data['entity'], as_of=data.get('as_of'))
print(json.dumps(result))
`;

const PY_KG_TIMELINE = `
import sys, json
from mempalace.knowledge_graph import KnowledgeGraph
data = json.load(sys.stdin)
kg = KnowledgeGraph(palace_path=data['palace_path'])
result = kg.timeline(data['entity'])
print(json.dumps(result))
`;

// ─── Service class ───────────────────────────────────────────

export class MemPalaceService {
  // ── Lifecycle ─────────────────────────────────────────────

  /**
   * Provision a new palace for a project.
   * Called after project.create in the DB — fire-and-forget is acceptable.
   */
  async initProject(projectId: string, slug: string): Promise<void> {
    const palace = palacePath(projectId);
    const wing = wingName(slug);

    try {
      await mkdir(palace, { recursive: true });

      // Write a minimal wing_config.json so MemPalace knows this project
      const wingConfig = {
        default_wing: wing,
        wings: {
          [wing]: { type: 'project', keywords: [slug] },
        },
      };
      await writeFile(
        join(palace, 'wing_config.json'),
        JSON.stringify(wingConfig, null, 2),
        'utf8',
      );

      logger.info({ projectId, slug, palace }, 'MemPalace palace initialised');
    } catch (err) {
      logger.warn(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'MemPalace initProject failed — continuing without memory',
      );
    }
  }

  /**
   * Mine a project's source files into the palace.
   * Called after code indexing completes (first sync, re-index).
   */
  async mineProject(projectId: string, slug: string, codePath: string): Promise<void> {
    const palace = palacePath(projectId);
    const wing = wingName(slug);

    try {
      await runProcess('mempalace', [
        'mine', codePath,
        '--wing', wing,
        '--palace', palace,
      ], { timeoutMs: 300_000 }); // 5min for large repos

      logger.info({ projectId, codePath }, 'MemPalace mine completed');
    } catch (err) {
      logger.warn(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'MemPalace mineProject failed',
      );
    }
  }

  // ── Conversation memory ───────────────────────────────────

  /**
   * Store an AI conversation exchange as a drawer in the palace.
   * Called fire-and-forget from extractSessionInsights().
   *
   * Hall routing:
   *  - error/debug sessions → hall_events / room_debugging
   *  - AI queries       → hall_discoveries / room_analysis
   *  - general chat     → hall_events / room_sessions
   */
  async addDrawer(opts: {
    projectId: string;
    slug: string;
    sessionId: string;
    sessionType: string;
    content: string;
  }): Promise<void> {
    const palace = palacePath(opts.projectId);
    const wing = wingName(opts.slug);

    const hall = this._hallForSessionType(opts.sessionType);
    const room = this._roomForSessionType(opts.sessionType);

    try {
      await runPython(PY_ADD_DRAWER, {
        content: opts.content,
        wing,
        hall,
        room,
        palace_path: palace,
      });
      logger.debug({ projectId: opts.projectId, sessionId: opts.sessionId, hall, room }, 'MemPalace drawer added');
    } catch (err) {
      logger.warn(
        { projectId: opts.projectId, err: err instanceof Error ? err.message : String(err) },
        'MemPalace addDrawer failed',
      );
    }
  }

  // ── Search ───────────────────────────────────────────────

  /**
   * Semantic search across a project's palace wing.
   * Returns a formatted context string suitable for LLM injection.
   */
  async search(projectId: string, slug: string, query: string): Promise<string> {
    const palace = palacePath(projectId);
    const wing = wingName(slug);

    try {
      const raw = await runProcess('mempalace', [
        'search', query,
        '--wing', wing,
        '--palace', palace,
      ], { timeoutMs: 15_000 });

      if (!raw.trim()) return '';
      return `\n### Project Memory (MemPalace)\n${raw.trim()}\n`;
    } catch (err) {
      logger.debug(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'MemPalace search failed — degrading gracefully',
      );
      return '';
    }
  }

  /**
   * Load the L0 + L1 memory context for a project (wake-up layer).
   * ~170 tokens — loaded at session start.
   */
  async wakeUp(projectId: string, slug: string): Promise<string> {
    const palace = palacePath(projectId);
    const wing = wingName(slug);

    try {
      const raw = await runProcess('mempalace', [
        'wake-up',
        '--wing', wing,
        '--palace', palace,
      ], { timeoutMs: 10_000 });

      return raw.trim();
    } catch {
      return '';
    }
  }

  // ── Knowledge Graph ──────────────────────────────────────

  async kgAdd(projectId: string, triple: KGTriple): Promise<void> {
    const palace = palacePath(projectId);
    try {
      await runPython(PY_KG_ADD, {
        palace_path: palace,
        subject: triple.subject,
        relation: triple.relation,
        object: triple.object,
        valid_from: triple.validFrom ?? new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      logger.debug(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'MemPalace kgAdd failed',
      );
    }
  }

  async kgQuery(projectId: string, entity: string, asOf?: string): Promise<unknown[]> {
    const palace = palacePath(projectId);
    try {
      const result = await runPython(PY_KG_QUERY, {
        palace_path: palace,
        entity,
        as_of: asOf,
      });
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  async kgTimeline(projectId: string, entity: string): Promise<unknown[]> {
    const palace = palacePath(projectId);
    try {
      const result = await runPython(PY_KG_TIMELINE, {
        palace_path: palace,
        entity,
      });
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  }

  // ── Status ───────────────────────────────────────────────

  async status(projectId: string, slug: string): Promise<string> {
    const palace = palacePath(projectId);
    const wing = wingName(slug);
    try {
      return await runProcess('mempalace', [
        'status',
        '--wing', wing,
        '--palace', palace,
      ], { timeoutMs: 10_000 });
    } catch {
      return 'Memory status unavailable';
    }
  }

  // ── Mine project documents (README, docs/) ───────────────

  /**
   * Write pushed documents to a temp directory and mine them via MemPalace.
   * MemPalace uses its own chromadb vector store — no Ollama dependency.
   * This runs alongside pgvector indexing and provides a fallback retrieval
   * path when Ollama is unavailable for embeddings.
   */
  async mineDocs(
    projectId: string,
    slug: string,
    docs: Array<{ path: string; content: string }>,
  ): Promise<void> {
    if (docs.length === 0) return;
    const palace = palacePath(projectId);
    const wing = wingName(slug);
    const tmpDir = join(tmpdir(), `omnious-docs-${randomBytes(8).toString('hex')}`);
    try {
      await mkdir(tmpDir, { recursive: true });
      await Promise.all(
        docs.map(async (doc) => {
          // Sanitize path to a safe filename — preserve extension
          const safeName = doc.path.replace(/[^a-zA-Z0-9._-]/g, '_');
          await writeFile(join(tmpDir, safeName), doc.content, 'utf8');
        }),
      );
      await runProcess('mempalace', [
        'mine', tmpDir,
        '--wing', wing,
        '--palace', palace,
      ], { timeoutMs: 120_000 });
      logger.info({ projectId, docCount: docs.length }, 'MemPalace mineDocs completed');
    } catch (err) {
      logger.warn(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'MemPalace mineDocs failed — continuing without memory',
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => null);
    }
  }

  // ── Mine conversation exchange from temp file ─────────────

  /**
   * Write a conversation exchange to a temp file and mine it.
   * Used for mining AI chat history that isn't on disk as files.
   */
  async mineConversation(
    projectId: string,
    slug: string,
    sessionId: string,
    transcript: string,
  ): Promise<void> {
    const palace = palacePath(projectId);
    const wing = wingName(slug);

    // Write to a secure temp dir — random suffix prevents collisions
    const tmpDir = join(tmpdir(), `omnious-mem-${randomBytes(8).toString('hex')}`);
    const tmpFile = join(tmpDir, `session_${sessionId}.txt`);

    try {
      await mkdir(tmpDir, { recursive: true });
      await writeFile(tmpFile, transcript, 'utf8');

      await runProcess('mempalace', [
        'mine', tmpDir,
        '--mode', 'convos',
        '--wing', wing,
        '--palace', palace,
      ], { timeoutMs: 60_000 });

      logger.debug({ projectId, sessionId }, 'MemPalace mineConversation completed');
    } catch (err) {
      logger.warn(
        { projectId, err: err instanceof Error ? err.message : String(err) },
        'MemPalace mineConversation failed',
      );
    } finally {
      // Always clean up the temp directory
      await rm(tmpDir, { recursive: true, force: true }).catch(() => null);
    }
  }

  // ── Private helpers ───────────────────────────────────────

  private _hallForSessionType(sessionType: string): string {
    switch (sessionType) {
      case 'why_broke':
      case 'explain_flow':
        return 'hall_discoveries';
      case 'fix_it':
      case 'security_scan':
        return 'hall_events';
      case 'graph_query':
        return 'hall_facts';
      default:
        return 'hall_events';
    }
  }

  private _roomForSessionType(sessionType: string): string {
    switch (sessionType) {
      case 'why_broke':
      case 'fix_it':
        return 'room_debugging';
      case 'explain_flow':
      case 'graph_query':
        return 'room_analysis';
      case 'security_scan':
        return 'room_security';
      case 'translate':
        return 'room_refactoring';
      default:
        return 'room_sessions';
    }
  }
}

/** Singleton instance — import this from anywhere in the backend */
export const memPalaceService = new MemPalaceService();
