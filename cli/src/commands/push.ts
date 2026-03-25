import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { loadConfig } from '../config/loader.js';
import { resolveApiKey } from '../api/auth.js';
import { OmniousApiClient } from '../api/client.js';
import { getGitContext } from '../utils/git.js';
import { logger } from '../utils/logger.js';
import { runRules } from '../rules/index.js';
import type { Diagnostic } from '../rules/index.js';
import type { OIRIndex } from '../oir/types.js';

const CACHE_DIR = '.omnious';
const INDEX_FILE = 'index.json';
const PUSH_STATE_FILE = 'last-push.json';

/** Batch size for node/edge uploads */
const BATCH_SIZE = 500;

/** Simple sleep helper for retry delays */
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

interface PushOptions {
  apiKey?: string;
  config?: string;
  force?: boolean;
  clean?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  /** Internal: suppress banner when called from `omnious sync` */
  _skipBanner?: boolean;
}

interface PushState {
  project_hash: string;
  pushed_at: string;
  nodes_pushed: number;
  edges_pushed: number;
  /** Per-file content hashes from the last successful push (enables differential push) */
  file_hashes: Record<string, string>;
}

/**
 * `omnious push` — upload OIR graph to the Omnious backend
 *
 * Reads .omnious/index.json, diffs against last push, sends new/changed data.
 */
export async function pushCommand(opts: PushOptions): Promise<void> {
  const cwd = process.cwd();
  if (!opts._skipBanner) {
    logger.banner();
    console.log('');
  }

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
      '  Set OMNIOUS_PROJECT_KEY env var, run `omnious login`, or add project_key to .omnious.yml',
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

  // Create API client early (needed for stale cache detection)
  const client = new OmniousApiClient(config.api.url, apiKey);

  // ── Differential diff: determine changed / stale files ──
  let lastPush = loadPushState(cwd);

  // --clean flag: wipe local push state to force a full re-push
  if (opts.clean && lastPush) {
    const statePath = path.join(cwd, CACHE_DIR, PUSH_STATE_FILE);
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    lastPush = null;
    if (opts.verbose) {
      logger.dim('  Cleaned push state — will do a full push');
    }
  }

  // Fast-path: project hash matches and not --force
  if (!opts.force && lastPush && lastPush.project_hash === index.project_hash) {
    // Auto-detect stale cache: check if the server actually has data.
    // This helps when the backend was wiped but local cache thinks everything is synced.
    try {
      const serverStatus = await client.getProjectStatus();
      if (serverStatus && serverStatus.node_count === 0 && lastPush.nodes_pushed > 0) {
        logger.warn('Server has 0 nodes but local cache says push was successful.');
        logger.dim('  Auto-cleaning push state and doing a full push…');
        const statePath = path.join(cwd, CACHE_DIR, PUSH_STATE_FILE);
        if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
        lastPush = null;
        // Fall through to full push logic
      } else {
        logger.infoBox(
          [
            'Project hash unchanged — already up to date.',
            `${logger.theme.muted('Use')} ${logger.theme.accent('--force')} ${logger.theme.muted('to push anyway.')}`,
          ],
          '● Up to Date',
        );
        return;
      }
    } catch {
      // If health check fails, just show up-to-date message
      logger.infoBox(
        [
          'Project hash unchanged — already up to date.',
          `${logger.theme.muted('Use')} ${logger.theme.accent('--force')} ${logger.theme.muted('to push anyway.')}`,
        ],
        '● Up to Date',
      );
      return;
    }
  }

  const prevFileHashes: Record<string, string> = lastPush?.file_hashes ?? {};

  // Files in current index whose hash differs from last push (new or modified)
  const changedFilePaths = new Set<string>(
    Object.entries(index.files)
      .filter(([fp, hash]) => prevFileHashes[fp] !== hash)
      .map(([fp]) => fp),
  );

  // Files that existed in the last push but are gone now (deleted/renamed)
  const staleFilePaths = Object.keys(prevFileHashes).filter(
    (fp) => !(fp in index.files),
  );

  // On first push (no history) or --force: treat every file as changed
  const isFullPush = opts.force || !lastPush;

  if (opts.verbose) {
    if (!isFullPush) {
      const changed = changedFilePaths.size;
      const stale = staleFilePaths.length;
      logger.dim(`  Differential: ${changed} changed file(s), ${stale} deleted file(s)`);
    } else {
      logger.dim('  Full push (no prior push state or --force)');
    }
  }

  // Get git context
  const gitContext = getGitContext(cwd);
  if (gitContext && opts.verbose) {
    logger.dim(
      `  Git: ${gitContext.branch} @ ${gitContext.commit_hash?.slice(0, 7)}`,
    );
  }

  // Health check
  spinner.start('Connecting to Omnious…');
  const healthy = await client.healthCheck();
  if (!healthy) {
    spinner.fail(`Cannot reach API at ${config.api.url}`);
    process.exitCode = 1;
    return;
  }
  spinner.succeed('Connected');

  // Select nodes/edges to push (differential or full)
  const nodesToPush = isFullPush
    ? index.nodes
    : index.nodes.filter((n) => changedFilePaths.has(n.file_path));

  // Edges to push: those originating from a changed node
  const changedOirIds = new Set(nodesToPush.map((n) => n.oir_id));
  const edgesToPush = isFullPush
    ? index.edges
    : index.edges.filter((e) => changedOirIds.has(e.source_oir_id));

  if (opts.dryRun) {
    console.log('');
    const dryLines = [
      `Would push ${logger.theme.brand(String(nodesToPush.length))} nodes + ${logger.theme.brand(String(edgesToPush.length))} edges`,
    ];
    if (!isFullPush) {
      dryLines.push(`(${changedFilePaths.size} changed file(s) out of ${Object.keys(index.files).length} total)`);
    }
    if (staleFilePaths.length > 0) {
      dryLines.push(`Would delete nodes from ${staleFilePaths.length} removed file(s)`);
    }
    dryLines.push('Nothing sent.');
    logger.warnBox(dryLines, '⚠ Dry Run');
    return;
  }

  const totalNodes = nodesToPush.length;
  const totalEdges = edgesToPush.length;
  let totalNodesUpserted = 0;
  let totalEdgesUpserted = 0;
  let totalEdgesSkipped = 0;
  // Captured from the first successful push response for display
  let pushedProjectName: string | null = null;
  let pushedWorkspaceSlug: string | null = null;

  // Phase 1: Push changed nodes
  // First batch also carries cleanup metadata (stale + changed file paths for the backend)
  const nodeChunks = chunk(nodesToPush, BATCH_SIZE);
  if (nodeChunks.length > 0) {
    spinner.start(`Pushing ${totalNodes} node(s)…`);
    for (let i = 0; i < nodeChunks.length; i++) {
      let nodeResult: Awaited<ReturnType<typeof client.pushGraph>> | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          nodeResult = await client.pushGraph(
            nodeChunks[i],
            [],
            i === 0 ? gitContext ?? undefined : undefined,
            i === 0 ? index.project_hash : undefined,
            i === 0 ? staleFilePaths : [],
            i === 0 ? [...changedFilePaths] : [],
          );
          break;
        } catch (err) {
          if (attempt === 2) {
            spinner.fail(`Node push failed on batch ${i + 1}`);
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(msg);
            process.exitCode = 1;
            return;
          }
          logger.dim(`  Batch ${i + 1} failed, retrying in 2s…`);
          await sleep(2000);
        }
      }
      if (nodeResult) {
        totalNodesUpserted += nodeResult.nodes_upserted;
        if (i === 0) {
          pushedProjectName = nodeResult.project_name;
          pushedWorkspaceSlug = nodeResult.workspace_slug;
        }
        if (nodeChunks.length > 1) {
          spinner.text = `Pushing nodes… batch ${i + 1}/${nodeChunks.length}`;
        }
      }
    }
    spinner.succeed(`${totalNodesUpserted} node(s) upserted`);
  } else if (staleFilePaths.length > 0 || changedFilePaths.size > 0) {
    // No nodes to push but cleanup is still needed (e.g. a file was deleted)
    try {
      await client.pushGraph(
        [],
        [],
        undefined,
        index.project_hash,
        staleFilePaths,
        [...changedFilePaths],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Cleanup failed: ${msg}`);
      process.exitCode = 1;
      return;
    }
  }

  // Phase 2: Push edges from changed nodes (all nodes are now in the DB)
  const edgeChunks = chunk(edgesToPush, BATCH_SIZE);
  if (edgeChunks.length > 0) {
    spinner.start(`Pushing ${totalEdges} edge(s)…`);
    for (let i = 0; i < edgeChunks.length; i++) {
      let edgeResult: Awaited<ReturnType<typeof client.pushGraph>> | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          edgeResult = await client.pushGraph(
            [],
            edgeChunks[i],
            undefined,
            undefined,
          );
          break;
        } catch (err) {
          if (attempt === 2) {
            spinner.fail(`Edge push failed on batch ${i + 1}`);
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(msg);
            process.exitCode = 1;
            return;
          }
          logger.dim(`  Batch ${i + 1} failed, retrying in 2s…`);
          await sleep(2000);
        }
      }
      if (edgeResult) {
        totalEdgesUpserted += edgeResult.edges_upserted;
        totalEdgesSkipped += edgeResult.edges_skipped;
        if (i === 0 && pushedProjectName === null) {
          pushedProjectName = edgeResult.project_name;
          pushedWorkspaceSlug = edgeResult.workspace_slug;
        }
        if (edgeChunks.length > 1) {
          spinner.text = `Pushing edges… batch ${i + 1}/${edgeChunks.length}`;
        }
      }
    }
    spinner.succeed(`${totalEdgesUpserted} edge(s) upserted`);
  }

  // Save push state (include current file hashes for next differential push)
  const pushedAt = new Date().toISOString();
  savePushState(cwd, {
    project_hash: index.project_hash,
    pushed_at: pushedAt,
    nodes_pushed: totalNodesUpserted,
    edges_pushed: totalEdgesUpserted,
    file_hashes: index.files,
  });

  // Summary box
  const summaryLines: string[] = [];
  if (pushedProjectName) {
    const projectLabel = pushedWorkspaceSlug
      ? `${pushedProjectName}  (workspace: ${pushedWorkspaceSlug})`
      : pushedProjectName;
    summaryLines.push(`${logger.label('Project')} ${projectLabel}`);
  }
  summaryLines.push(
    `${logger.label('Nodes')} ${totalNodesUpserted} upserted`,
    `${logger.label('Edges')} ${totalEdgesUpserted} upserted`,
  );
  if (totalEdgesSkipped > 0) {
    summaryLines.push(`${logger.label('Skipped')} ${logger.theme.highlight(String(totalEdgesSkipped))} edges (unresolved targets)`);
  }
  summaryLines.push(`${logger.label('Hash')} ${index.project_hash.slice(0, 12)}…`);
  summaryLines.push(`${logger.label('Pushed at')} ${new Date(pushedAt).toLocaleString()}`);

  logger.successBox(summaryLines, '✔ Graph Synced');

  // ── Phase 3: Static analysis ──
  spinner.start('Running static analysis rules…');
  const diagnostics: Diagnostic[] = runRules(index, undefined, config.rules);
  if (diagnostics.length > 0) {
    spinner.succeed(
      `Found ${diagnostics.length} diagnostic(s)`,
    );

    // Group by severity for display
    const bySeverity: Record<string, number> = {};
    for (const d of diagnostics) {
      bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
    }
    const severityLine = Object.entries(bySeverity)
      .map(([sev, count]) => `${count} ${sev}`)
      .join(', ');
    logger.dim(`  ${severityLine}`);

    // Push diagnostics to backend
    spinner.start('Uploading diagnostics…');
    try {
      const result = await client.pushDiagnostics(diagnostics);
      spinner.succeed(`${result.upserted} diagnostic(s) synced`);
    } catch (err) {
      spinner.warn('Failed to upload diagnostics (non-fatal)');
      if (opts.verbose) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.dim(`  ${msg}`);
      }
    }
  } else {
    spinner.succeed('No issues found');
  }

  // ── Phase 4: Index project documentation ──
  spinner.start('Scanning for project documentation…');
  const docs = collectProjectDocs(cwd);
  if (docs.length > 0) {
    spinner.succeed(`Found ${docs.length} document(s)`);
    spinner.start('Indexing documentation for AI…');
    try {
      const docResult = await client.pushDocuments(docs);
      const parts: string[] = [];
      if (docResult.indexed > 0) parts.push(`${docResult.indexed} indexed`);
      if (docResult.skipped > 0) parts.push(`${docResult.skipped} unchanged`);
      if (docResult.deleted > 0) parts.push(`${docResult.deleted} removed`);
      spinner.succeed(`Docs: ${parts.join(', ')}`);
    } catch (err) {
      spinner.warn('Failed to index docs (non-fatal)');
      if (opts.verbose) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.dim(`  ${msg}`);
      }
    }
  } else {
    spinner.info('No documentation files found');
  }

  // ── Phase 5: Push insights ──
  const insights = generatePushInsights(index, diagnostics);
  if (insights.length > 0) {
    console.log('');
    logger.infoBox(insights, '💡 Insights');
  }
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

/** Max content size per document to send (4KB — larger docs get truncated for embedding quality) */
const MAX_DOC_CONTENT = 8_000;

/** Document file patterns to look for (relative to project root) */
const DOC_PATTERNS = [
  'README.md', 'README.rst', 'README.txt', 'README',
  'CONTRIBUTING.md', 'ARCHITECTURE.md', 'CHANGELOG.md',
  'docs/**/*.md', 'doc/**/*.md',
] as const;

/**
 * Collect project documentation files for RAG indexing.
 * Returns paths and content for README, docs/, and other common doc locations.
 */
function collectProjectDocs(cwd: string): Array<{ path: string; content: string; doc_type: string }> {
  const docs: Array<{ path: string; content: string; doc_type: string }> = [];
  const seen = new Set<string>();

  // Check fixed-path files
  for (const pattern of DOC_PATTERNS) {
    if (pattern.includes('*')) continue; // Handle glob patterns separately
    const fullPath = path.join(cwd, pattern);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const relPath = pattern;
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      const content = fs.readFileSync(fullPath, 'utf-8').slice(0, MAX_DOC_CONTENT);
      if (content.length >= 20) {
        docs.push({ path: relPath, content, doc_type: 'markdown' });
      }
    }
  }

  // Scan docs/ and doc/ directories for .md files
  for (const docDir of ['docs', 'doc']) {
    const dirPath = path.join(cwd, docDir);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;
    scanDocsDir(dirPath, cwd, docs, seen, 0);
  }

  return docs;
}

function scanDocsDir(
  dirPath: string,
  rootDir: string,
  docs: Array<{ path: string; content: string; doc_type: string }>,
  seen: Set<string>,
  depth: number,
): void {
  if (depth > 3) return; // Don't recurse too deep
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        scanDocsDir(fullPath, rootDir, docs, seen, depth + 1);
      } else if (entry.isFile() && /\.(md|mdx|rst|txt)$/i.test(entry.name)) {
        const relPath = path.relative(rootDir, fullPath);
        if (seen.has(relPath) || docs.length >= 50) continue;
        seen.add(relPath);
        const content = fs.readFileSync(fullPath, 'utf-8').slice(0, MAX_DOC_CONTENT);
        if (content.length >= 20) {
          docs.push({ path: relPath, content, doc_type: 'markdown' });
        }
      }
    }
  } catch {
    // Skip unreadable directories
  }
}

/**
 * Analyze the OIR index and diagnostics to generate actionable insights for the user.
 * Detects: circular dependencies, hub nodes (high fan-in/fan-out), large files, and complexity hotspots.
 */
function generatePushInsights(index: OIRIndex, diagnostics: Diagnostic[]): string[] {
  const insights: string[] = [];

  // 1. Circular dependency count
  const cycleDiags = diagnostics.filter((d) => d.rule_id === 'circular-deps');
  if (cycleDiags.length > 0) {
    insights.push(
      `⚠ ${cycleDiags.length} circular dependency chain(s) detected — these can cause import ordering issues and make refactoring harder.`,
    );
  }

  // 2. Hub nodes — nodes with high connection counts (fan-in + fan-out)
  const connectionMap = new Map<string, number>();
  for (const edge of index.edges) {
    connectionMap.set(edge.source_oir_id, (connectionMap.get(edge.source_oir_id) ?? 0) + 1);
    connectionMap.set(edge.target_oir_id, (connectionMap.get(edge.target_oir_id) ?? 0) + 1);
  }
  const hubThreshold = Math.max(15, Math.ceil(index.edges.length / index.nodes.length * 3));
  const hubs: Array<{ name: string; filePath: string; connections: number }> = [];
  for (const node of index.nodes) {
    const count = connectionMap.get(node.oir_id) ?? 0;
    if (count >= hubThreshold) {
      hubs.push({ name: node.name, filePath: node.file_path, connections: count });
    }
  }
  if (hubs.length > 0) {
    hubs.sort((a, b) => b.connections - a.connections);
    const top = hubs.slice(0, 3);
    const hubList = top.map((h) => `${h.name} (${h.connections} connections)`).join(', ');
    insights.push(
      `🔗 ${hubs.length} hub node(s) with high connectivity: ${hubList}. Consider splitting to reduce coupling.`,
    );
  }

  // 3. Large files — files with many nodes
  const nodesPerFile = new Map<string, number>();
  for (const node of index.nodes) {
    nodesPerFile.set(node.file_path, (nodesPerFile.get(node.file_path) ?? 0) + 1);
  }
  const largeFiles: Array<{ path: string; count: number }> = [];
  for (const [fp, count] of nodesPerFile) {
    if (count >= 20) {
      largeFiles.push({ path: fp, count });
    }
  }
  if (largeFiles.length > 0) {
    largeFiles.sort((a, b) => b.count - a.count);
    const top = largeFiles.slice(0, 3);
    const fileList = top.map((f) => `${f.path.split('/').pop()} (${f.count} symbols)`).join(', ');
    insights.push(
      `📦 ${largeFiles.length} file(s) with high symbol density: ${fileList}. Large files are harder to navigate and test.`,
    );
  }

  // 4. Large function warnings from diagnostics
  const largeFnDiags = diagnostics.filter((d) => d.rule_id === 'large-functions');
  if (largeFnDiags.length > 0) {
    insights.push(
      `📏 ${largeFnDiags.length} function(s) exceed recommended size — consider extracting helpers.`,
    );
  }

  // 5. High unused export count
  const unusedDiags = diagnostics.filter((d) => d.rule_id === 'unused-exports');
  if (unusedDiags.length >= 10) {
    insights.push(
      `🧹 ${unusedDiags.length} potentially unused export(s) — dead code removal could reduce bundle size.`,
    );
  }

  // 6. Project size summary
  const nodeTypes = index.summary.nodes_by_type;
  const topTypes = Object.entries(nodeTypes)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .slice(0, 3)
    .map(([type, count]) => `${count} ${type}s`)
    .join(', ');
  if (topTypes) {
    insights.push(
      `📊 Graph: ${index.nodes.length} nodes, ${index.edges.length} edges across ${Object.keys(index.files).length} files (${topTypes}).`,
    );
  }

  return insights;
}
