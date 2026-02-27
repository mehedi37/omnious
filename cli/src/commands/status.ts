import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
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
  logger.banner();

  // Load config early (needed for project link + remote)
  let config;
  try {
    config = loadConfig(opts.config);
  } catch {
    // No config — still show local status
  }

  // Local index status
  const index = loadLocalIndex(cwd);
  const pushState = loadPushState(cwd);

  logger.section('Local Index');

  if (!index) {
    logger.warn('No local index found. Run `omnious index` first.');
  } else {
    logger.kv('Files', index.summary.total_files);
    logger.kv('Nodes', index.summary.total_nodes);
    logger.kv('Edges', index.summary.total_edges);
    if (index.summary.parse_errors > 0) {
      logger.kv('Parse Errors', logger.theme.highlight(String(index.summary.parse_errors)));
    }
    logger.kv('Indexed At', formatLocalTime(index.timestamp));
    logger.kv('Project Hash', `${index.project_hash.slice(0, 12)}…`);

    // Node type breakdown with colored badges
    console.log('');
    logger.nodeTypeBreakdown(index.summary.nodes_by_type);
  }

  // Push state
  logger.section('Push Status');

  if (!pushState) {
    logger.warn('Never pushed. Run `omnious push` to sync.');
  } else {
    const synced = index && pushState.project_hash === index.project_hash;
    logger.kv('Last Push', formatLocalTime(pushState.pushed_at));
    logger.kv('Nodes Pushed', pushState.nodes_pushed);
    logger.kv('Edges Pushed', pushState.edges_pushed);

    console.log('');
    if (synced) {
      logger.success('Local index matches last push');
    } else {
      logger.warn('Local index has changed since last push');
      logger.dim('  Run `omnious push` to sync');
    }
  }

  // Project link (derived from config)
  if (config?.project?.workspace && config?.project?.slug) {
    const dashboardUrl = deriveDashboardUrl(config.api.url, config.project.workspace, config.project.slug);
    if (dashboardUrl) {
      console.log('');
      logger.step('View in dashboard:');
      logger.link(dashboardUrl, dashboardUrl);
    }
  }

  // Remote status (optional)
  if (opts.remote) {
    logger.section('Remote Status');

    if (!config) {
      logger.warn('No config found. Cannot check remote status.');
      return;
    }

    const apiKey = resolveApiKey({
      cliFlag: opts.apiKey,
      configKey: config.api.project_key,
    });

    if (!apiKey) {
      logger.warn('No API key configured. Cannot check remote status.');
      return;
    }

    const spinner = ora({ isSilent: !!process.env['CI'] });
    spinner.start('Fetching remote status…');

    const client = new OmniousApiClient(config.api.url, apiKey);

    try {
      const projectStatus = await client.getProjectStatus();
      spinner.succeed('Remote status fetched');

      logger.kv('Project', `${projectStatus.name} (${projectStatus.slug})`);
      logger.kv('Status', projectStatus.status);
      logger.kv('Remote Nodes', projectStatus.node_count);
      logger.kv('Remote Edges', projectStatus.edge_count);
      logger.kv('Traces', projectStatus.trace_count);
      logger.kv('Errors', projectStatus.error_count);
      logger.kv('Last Indexed', projectStatus.last_indexed_at
        ? formatLocalTime(projectStatus.last_indexed_at)
        : logger.theme.muted('never'));

      // Compare local vs remote
      if (index) {
        const nodeDiff = index.summary.total_nodes - projectStatus.node_count;
        const edgeDiff = index.summary.total_edges - projectStatus.edge_count;
        if (nodeDiff !== 0 || edgeDiff !== 0) {
          console.log('');
          logger.step(
            `Local vs remote: Δ nodes: ${logger.diff(nodeDiff)}, Δ edges: ${logger.diff(edgeDiff)}`,
          );
        }
      }
    } catch (err: unknown) {
      spinner.fail('Failed to fetch remote status');
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(msg);
    }
  }
}

// ── Helpers ──

/** Format ISO timestamp to system locale + timezone */
function formatLocalTime(iso: string): string {
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleString();
  } catch {
    return iso;
  }
}

/** Derive frontend dashboard URL from backend API URL */
function deriveDashboardUrl(
  apiUrl: string,
  workspace: string,
  projectSlug: string,
): string | null {
  try {
    const url = new URL(apiUrl);

    // localhost/127.0.0.1: swap port 4000 → 3000
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      url.port = '3000';
    } else {
      // Production: assume frontend is at the root domain without explicit port
      // e.g. api.omnious.dev → omnious.dev, or strip port entirely
      const host = url.hostname.replace(/^api\./, '');
      url.hostname = host;
      url.port = '';
    }

    url.pathname = `/dashboard/${workspace}/${projectSlug}/graph`;
    return url.toString();
  } catch {
    return null;
  }
}

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
