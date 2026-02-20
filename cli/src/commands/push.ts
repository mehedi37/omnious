import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { loadConfig } from '../config/loader.js';
import { resolveApiKey } from '../api/auth.js';
import { OmniousApiClient } from '../api/client.js';
import { getGitContext } from '../utils/git.js';
import { logger } from '../utils/logger.js';
import type { OIRIndex } from '../oir/types.js';

const CACHE_DIR = '.omnious';
const INDEX_FILE = 'index.json';
const PUSH_STATE_FILE = 'last-push.json';

/** Batch size for node/edge uploads */
const BATCH_SIZE = 500;

interface PushOptions {
  apiKey?: string;
  config?: string;
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

interface PushState {
  project_hash: string;
  pushed_at: string;
  nodes_pushed: number;
  edges_pushed: number;
}

/**
 * `omnious push` — upload OIR graph to the Omnious backend
 *
 * Reads .omnious/index.json, diffs against last push, sends new/changed data.
 */
export async function pushCommand(opts: PushOptions): Promise<void> {
  const cwd = process.cwd();
  const spinner = ora({ isSilent: !!process.env['CI'] });

  // Load config
  const config = loadConfig(opts.config);

  // Resolve API key
  const apiKey = resolveApiKey({
    cliFlag: opts.apiKey,
    configKey: config.api.project_key,
  });

  if (!apiKey) {
    logger.error('No API key found.');
    logger.dim(
      'Set OMNIOUS_PROJECT_KEY env var, run `omnious login`, or add project_key to .omnious.yml',
    );
    process.exitCode = 1;
    return;
  }

  // Load local index
  const index = loadIndex(cwd);
  if (!index) {
    logger.error('No local index found. Run `omnious index` first.');
    process.exitCode = 1;
    return;
  }

  // Check if push needed (unless --force)
  if (!opts.force) {
    const lastPush = loadPushState(cwd);
    if (lastPush && lastPush.project_hash === index.project_hash) {
      logger.info('Already up to date (project hash unchanged).');
      logger.dim('Use --force to push anyway.');
      return;
    }
  }

  // Get git context
  const gitContext = getGitContext(cwd);
  if (gitContext && opts.verbose) {
    logger.dim(
      `Git: ${gitContext.branch} @ ${gitContext.commit_hash?.slice(0, 7)}`,
    );
  }

  // Create API client
  const client = new OmniousApiClient(config.api.url, apiKey);

  // Health check
  spinner.start('Connecting to Omnious...');
  const healthy = await client.healthCheck();
  if (!healthy) {
    spinner.fail(`Cannot reach API at ${config.api.url}`);
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Connected');

  if (opts.dryRun) {
    logger.info('');
    logger.info(
      `Would push ${index.nodes.length} nodes + ${index.edges.length} edges`,
    );
    logger.info('(dry run — nothing sent)');
    return;
  }

  // Push in batches
  const totalNodes = index.nodes.length;
  const totalEdges = index.edges.length;
  let totalNodesUpserted = 0;
  let totalEdgesUpserted = 0;
  let totalEdgesSkipped = 0;

  spinner.start(`Pushing ${totalNodes} nodes + ${totalEdges} edges...`);

  // Batch nodes and edges together for pushGraph calls
  const nodeChunks = chunk(index.nodes, BATCH_SIZE);
  const edgeChunks = chunk(index.edges, BATCH_SIZE);
  const maxBatches = Math.max(nodeChunks.length, edgeChunks.length, 1);

  for (let i = 0; i < maxBatches; i++) {
    const batchNodes = nodeChunks[i] ?? [];
    const batchEdges = edgeChunks[i] ?? [];

    try {
      const result = await client.pushGraph(
        batchNodes,
        batchEdges,
        i === 0 ? gitContext ?? undefined : undefined, // send git context only on first batch
      );
      totalNodesUpserted += result.nodes_upserted;
      totalEdgesUpserted += result.edges_upserted;
      totalEdgesSkipped += result.edges_skipped;

      spinner.text = `Pushing... batch ${i + 1}/${maxBatches}`;
    } catch (err) {
      spinner.fail(`Push failed on batch ${i + 1}`);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(msg);
      process.exitCode = 1;
      return;
    }
  }

  spinner.succeed('Push complete');

  // Save push state
  savePushState(cwd, {
    project_hash: index.project_hash,
    pushed_at: new Date().toISOString(),
    nodes_pushed: totalNodesUpserted,
    edges_pushed: totalEdgesUpserted,
  });

  // Summary
  logger.info('');
  logger.info('Push Summary:');
  logger.info(`  Nodes upserted:  ${totalNodesUpserted}`);
  logger.info(`  Edges upserted:  ${totalEdgesUpserted}`);
  if (totalEdgesSkipped > 0) {
    logger.warn(`  Edges skipped:   ${totalEdgesSkipped} (unresolved targets)`);
  }
  logger.success('Graph synced to Omnious');
}

// ── Helpers ──

function loadIndex(cwd: string): OIRIndex | null {
  const indexPath = path.join(cwd, CACHE_DIR, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;
  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(raw) as OIRIndex;
  } catch {
    return null;
  }
}

function loadPushState(cwd: string): PushState | null {
  const statePath = path.join(cwd, CACHE_DIR, PUSH_STATE_FILE);
  if (!fs.existsSync(statePath)) return null;
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as PushState;
  } catch {
    return null;
  }
}

function savePushState(cwd: string, state: PushState): void {
  const cacheDir = path.join(cwd, CACHE_DIR);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const statePath = path.join(cacheDir, PUSH_STATE_FILE);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
