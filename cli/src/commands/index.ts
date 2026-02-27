import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import { loadConfig } from '../config/loader.js';
import { walkFiles } from '../utils/fs.js';
import { extractFromFile, canExtract } from '../parsers/extractor-registry.js';
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
  /** Internal: suppress banner when called from `omnious sync` */
  _skipBanner?: boolean;
}

/**
 * `omnious index` — parse the codebase and build local OIR graph
 *
 * Uses gitignore-first file discovery and tree-sitter-based extractors.
 * Supports: TypeScript/JavaScript, Python, Go, Java, C#
 */
export async function indexCommand(opts: IndexOptions): Promise<void> {
  const cwd = process.cwd();
  if (!opts._skipBanner) {
    logger.banner();
    console.log('');
  }

  // Load config
  const config = loadConfig(opts.config);
  const spinner = ora({ isSilent: !!process.env['CI'] });

  // Step 1: Discover files (gitignore-first)
  spinner.start('Discovering files…');
  const files = await walkFiles(config, cwd);

  if (files.length === 0) {
    spinner.fail('No parseable files found.');
    logger.dim('  Make sure you\'re in the project root.');
    logger.dim('  Supported: .ts, .tsx, .js, .jsx, .py, .go, .java, .cs');
    process.exitCode = 1;
    return;
  }
  spinner.succeed(`Found ${logger.theme.brand(String(files.length))} files`);

  // Step 2: Check for incremental indexing
  const previousIndex = loadPreviousIndex(cwd);
  let skippedCount = 0;
  let parsedCount = 0;
  let noParserCount = 0;

  // Step 3: Parse files with tree-sitter extractors
  const builder = new OIRBuilder();
  const allErrors: ParseError[] = [];

  spinner.start('Parsing files…');

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

    // Check if we have an extractor for this file
    if (!canExtract(file)) {
      noParserCount++;
      if (opts.verbose) {
        logger.dim(`  Skipping ${file} (no extractor)`);
      }
      continue;
    }

    // Parse with tree-sitter + extract
    try {
      const result = extractFromFile(content, file);
      if (result) {
        builder.addParseResult(result, fileHash);
        parsedCount++;

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
      }
    } catch (err) {
      allErrors.push({
        file_path: file,
        line: null,
        message: `Extractor crash: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Update spinner
    if (i % 50 === 0) {
      spinner.text = `Parsing files… (${i + 1}/${files.length})`;
    }
  }

  spinner.succeed(`Parsed ${logger.theme.brand(String(parsedCount))} files`);

  // Step 4: Build index
  spinner.start('Building OIR graph…');
  const index = builder.build();
  spinner.succeed('OIR graph built');

  // Print summary
  const { summary } = index;

  logger.section('Index Summary');
  logger.kv('Files', summary.total_files);
  logger.kv('Nodes', summary.total_nodes);
  logger.kv('Edges', summary.total_edges);
  if (skippedCount > 0) {
    logger.kv('Unchanged', `${skippedCount} ${logger.theme.muted('(cached)')}`);
  }
  if (summary.parse_errors > 0) {
    logger.kv('Parse Errors', logger.theme.highlight(String(summary.parse_errors)));
  }

  // Node type breakdown
  logger.section('Nodes by Type');
  logger.nodeTypeBreakdown(summary.nodes_by_type);

  // Edge type breakdown (verbose only)
  if (opts.verbose) {
    logger.section('Edges by Type');
    for (const [type, count] of Object.entries(summary.edges_by_type).sort((a, b) => b[1] - a[1])) {
      logger.kv(type, count);
    }
  }

  if (opts.dryRun) {
    console.log('');
    logger.warnBox(['Parse without writing index file'], '⚠ Dry Run');
    return;
  }

  // Step 5: Write .omnious/index.json
  const cacheDir = path.join(cwd, CACHE_DIR);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const indexPath = path.join(cacheDir, INDEX_FILE);
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  // Diff from previous
  const diffLines: string[] = [`Wrote ${logger.theme.accent(path.relative(cwd, indexPath))}`];
  if (previousIndex) {
    const nodeDiff = index.nodes.length - previousIndex.nodes.length;
    const edgeDiff = index.edges.length - previousIndex.edges.length;
    if (nodeDiff !== 0 || edgeDiff !== 0) {
      diffLines.push(`Δ nodes: ${logger.diff(nodeDiff)}  Δ edges: ${logger.diff(edgeDiff)}`);
    }
    if (index.project_hash !== previousIndex.project_hash) {
      diffLines.push(`${logger.theme.highlight('Project hash changed')} — push recommended`);
    } else {
      diffLines.push(`${logger.theme.muted('Project hash unchanged')} — no push needed`);
    }
  }
  logger.successBox(diffLines);
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
