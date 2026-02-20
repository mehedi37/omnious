import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { loadConfig } from '../config/loader.js';
import { walkFiles } from '../utils/fs.js';
import { createDefaultRegistry } from '../parsers/registry.js';
import { OIRBuilder } from '../oir/builder.js';
import { hashFileContent } from '../oir/hasher.js';
import { logger } from '../utils/logger.js';
import type { OIRIndex, ParseError } from '../oir/types.js';

const CACHE_DIR = '.omnious';
const INDEX_FILE = 'index.json';

interface IndexOptions {
  config?: string;
  verbose?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

/**
 * `omnious index` — parse the codebase and build local OIR graph
 *
 * Reads .omnious.yml, discovers files, runs parsers, writes .omnious/index.json
 */
export async function indexCommand(opts: IndexOptions): Promise<void> {
  const cwd = process.cwd();

  // Load config
  const config = loadConfig(opts.config);
  const spinner = ora({ isSilent: !!process.env['CI'] });

  // Step 1: Discover files
  spinner.start('Discovering files...');
  const files = await walkFiles(config, cwd);

  if (files.length === 0) {
    spinner.fail('No files matched the include patterns.');
    logger.dim('Check "index.include" in .omnious.yml');
    process.exitCode = 1;
    return;
  }
  spinner.succeed(`Found ${files.length} files`);

  // Step 2: Check for incremental indexing
  const previousIndex = loadPreviousIndex(cwd);
  let skippedCount = 0;

  // Step 3: Parse files
  const registry = createDefaultRegistry();
  const builder = new OIRBuilder();
  const allErrors: ParseError[] = [];

  spinner.start('Parsing files...');

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const absPath = path.join(cwd, file);

    // Read file content
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch (err) {
      allErrors.push({
        file_path: file,
        line: null,
        message: `Failed to read: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // Check if file changed since last index (incremental)
    const fileHash = hashFileContent(content);
    if (
      !opts.force &&
      previousIndex &&
      previousIndex.files[file] === fileHash
    ) {
      // File unchanged — reuse previous nodes/edges
      const prevNodes = previousIndex.nodes.filter((n) => n.file_path === file);
      const prevEdges = previousIndex.edges.filter((e) =>
        prevNodes.some((n) => n.oir_id === e.source_oir_id),
      );
      builder.addParseResult(
        { nodes: prevNodes, edges: prevEdges, errors: [] },
        fileHash,
      );
      skippedCount++;
      continue;
    }

    // Find parser for file
    const parser = registry.detect(file);
    if (!parser) {
      if (opts.verbose) {
        logger.dim(`  Skipping ${file} (no parser for extension)`);
      }
      continue;
    }

    // Parse
    try {
      const result = parser.parse(content, file);
      builder.addParseResult(result, fileHash);

      if (result.errors.length > 0) {
        allErrors.push(...result.errors);
        if (opts.verbose) {
          for (const err of result.errors) {
            logger.warn(
              `  ${err.file_path}:${err.line ?? '?'} — ${err.message}`,
            );
          }
        }
      }
    } catch (err) {
      allErrors.push({
        file_path: file,
        line: null,
        message: `Parser crash: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Update spinner
    if (i % 50 === 0) {
      spinner.text = `Parsing files... (${i + 1}/${files.length})`;
    }
  }

  spinner.succeed('Parsing complete');

  // Step 4: Build index
  spinner.start('Building OIR graph...');
  const index = builder.build();
  spinner.succeed('OIR graph built');

  // Print summary
  const { summary } = index;
  logger.info('');
  logger.info('Index Summary:');
  logger.info(`  Files:       ${summary.total_files}`);
  logger.info(`  Nodes:       ${summary.total_nodes}`);
  logger.info(`  Edges:       ${summary.total_edges}`);
  if (skippedCount > 0) {
    logger.dim(`  Unchanged:   ${skippedCount} (reused from cache)`);
  }
  if (summary.parse_errors > 0) {
    logger.warn(`  Parse errors: ${summary.parse_errors}`);
  }

  // Node type breakdown
  if (opts.verbose) {
    logger.info('');
    logger.info('  Nodes by type:');
    for (const [type, count] of Object.entries(summary.nodes_by_type)) {
      logger.info(`    ${type}: ${count}`);
    }
    logger.info('  Edges by type:');
    for (const [type, count] of Object.entries(summary.edges_by_type)) {
      logger.info(`    ${type}: ${count}`);
    }
  }

  if (opts.dryRun) {
    logger.info('');
    logger.info('(dry run — not writing index.json)');
    return;
  }

  // Step 5: Write .omnious/index.json
  const cacheDir = path.join(cwd, CACHE_DIR);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const indexPath = path.join(cacheDir, INDEX_FILE);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  logger.success(`\nWrote ${path.relative(cwd, indexPath)}`);

  // Show diff from previous if available
  if (previousIndex) {
    const nodeDiff = index.nodes.length - previousIndex.nodes.length;
    const edgeDiff = index.edges.length - previousIndex.edges.length;
    if (nodeDiff !== 0 || edgeDiff !== 0) {
      logger.dim(
        `  Δ nodes: ${nodeDiff >= 0 ? '+' : ''}${nodeDiff}  ` +
          `Δ edges: ${edgeDiff >= 0 ? '+' : ''}${edgeDiff}`,
      );
    }
    if (index.project_hash !== previousIndex.project_hash) {
      logger.dim('  Project hash changed — push recommended');
    } else {
      logger.dim('  Project hash unchanged — no push needed');
    }
  }
}

/**
 * Load previous index from .omnious/index.json (if exists)
 */
function loadPreviousIndex(cwd: string): OIRIndex | null {
  const indexPath = path.join(cwd, CACHE_DIR, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return null;

  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(raw) as OIRIndex;
  } catch {
    return null;
  }
}
