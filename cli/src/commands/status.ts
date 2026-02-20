import fs from 'node:fs';
import path from 'node:path';
import Table from 'cli-table3';
import { loadConfig } from '../config/loader.js';
import { resolveApiKey } from '../api/auth.js';
import { OmniousApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';
import type { OIRIndex } from '../oir/types.js';

const CACHE_DIR = '.omnious';
const INDEX_FILE = 'index.json';
const PUSH_STATE_FILE = 'last-push.json';

interface StatusOptions {
  config?: string;
  apiKey?: string;
  remote?: boolean;
}

/**
 * `omnious status` — show local index + sync status
 */
export async function statusCommand(opts: StatusOptions): Promise<void> {
  const cwd = process.cwd();

  // Local index status
  const index = loadLocalIndex(cwd);
  const pushState = loadPushState(cwd);

  logger.info('Local Status:');

  if (!index) {
    logger.warn('  No local index found. Run `omnious index` first.');
  } else {
    const table = new Table({
      chars: { mid: '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' },
    });

    table.push(
      ['Files', index.summary.total_files],
      ['Nodes', index.summary.total_nodes],
      ['Edges', index.summary.total_edges],
      ['Parse Errors', index.summary.parse_errors],
      ['Indexed At', index.timestamp],
      ['Project Hash', index.project_hash.slice(0, 12) + '...'],
    );

    console.log(table.toString());

    // Show node type breakdown
    logger.info('');
    logger.info('Nodes by type:');
    for (const [type, count] of Object.entries(index.summary.nodes_by_type)) {
      logger.dim(`  ${type}: ${count}`);
    }
  }

  // Push state
  logger.info('');
  if (!pushState) {
    logger.warn('Never pushed. Run `omnious push` to sync.');
  } else {
    const synced =
      index && pushState.project_hash === index.project_hash;
    logger.info('Push Status:');
    logger.info(`  Last push:     ${pushState.pushed_at}`);
    logger.info(`  Nodes pushed:  ${pushState.nodes_pushed}`);
    logger.info(`  Edges pushed:  ${pushState.edges_pushed}`);

    if (synced) {
      logger.success('  ✓ Local index matches last push');
    } else {
      logger.warn('  ✗ Local index has changed since last push');
      logger.dim('    Run `omnious push` to sync');
    }
  }

  // Remote status (optional)
  if (opts.remote) {
    logger.info('');
    logger.info('Remote Status:');

    let config;
    try {
      config = loadConfig(opts.config);
    } catch {
      logger.warn('  No config found. Cannot check remote status.');
      return;
    }

    const apiKey = resolveApiKey({
      cliFlag: opts.apiKey,
      configKey: config.api.project_key,
    });

    if (!apiKey) {
      logger.warn('  No API key configured. Cannot check remote status.');
      return;
    }

    const client = new OmniousApiClient(config.api.url, apiKey);

    try {
      const projectStatus = await client.getProjectStatus();

      const remoteTable = new Table({
        chars: { mid: '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' },
      });

      remoteTable.push(
        ['Project', `${projectStatus.name} (${projectStatus.slug})`],
        ['Status', projectStatus.status],
        ['Remote Nodes', projectStatus.node_count],
        ['Remote Edges', projectStatus.edge_count],
        ['Traces', projectStatus.trace_count],
        ['Errors', projectStatus.error_count],
        ['Last Indexed', projectStatus.last_indexed_at ?? 'never'],
      );

      console.log(remoteTable.toString());

      // Compare local vs remote
      if (index) {
        const nodeDiff = index.summary.total_nodes - projectStatus.node_count;
        const edgeDiff = index.summary.total_edges - projectStatus.edge_count;
        if (nodeDiff !== 0 || edgeDiff !== 0) {
          logger.dim(
            `  Local vs remote: Δ nodes: ${nodeDiff >= 0 ? '+' : ''}${nodeDiff}, ` +
              `Δ edges: ${edgeDiff >= 0 ? '+' : ''}${edgeDiff}`,
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`  Failed to fetch remote status: ${msg}`);
    }
  }
}

// ── Helpers ──

function loadLocalIndex(cwd: string): OIRIndex | null {
  const indexPath = path.join(cwd, CACHE_DIR, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch {
    return null;
  }
}

interface PushState {
  project_hash: string;
  pushed_at: string;
  nodes_pushed: number;
  edges_pushed: number;
}

function loadPushState(cwd: string): PushState | null {
  const statePath = path.join(cwd, CACHE_DIR, PUSH_STATE_FILE);
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}
