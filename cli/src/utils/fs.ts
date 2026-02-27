import fs from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { OmniousConfig } from '../config/schema.js';
import { isParseableFile } from '../parsers/languages.js';

/**
 * Walk the file tree using gitignore-first discovery.
 *
 * Strategy:
 * 1. Start from project root, recursively scan all directories
 * 2. Respect .gitignore at every level (nested .gitignore files supported)
 * 3. Always skip .omnious/, .git/, node_modules/, etc.
 * 4. Only return files with parseable extensions (as defined in languages.ts)
 * 5. Apply config exclude patterns and size/count limits on top
 *
 * This approach requires ZERO configuration — no include patterns needed.
 */
export async function walkFiles(
  config: OmniousConfig,
  rootDir?: string,
): Promise<string[]> {
  const root = rootDir ?? process.cwd();
  const indexConfig = config.index;

  // Build the base ignore filter from root .gitignore + hardcoded excludes
  const rootIgnore = createIgnoreFilter(root);

  // Add config exclude patterns
  if (indexConfig.exclude.length > 0) {
    rootIgnore.add(indexConfig.exclude);
  }

  // Recursively walk
  const files: string[] = [];
  walkDir(root, root, rootIgnore, files, indexConfig.max_file_size);

  // If config has explicit include patterns, use them as a secondary filter
  // (legacy compat — new gitignore-first approach doesn't need them)
  const include = indexConfig.include;
  let result: string[];
  if (include && include.length > 0 && include[0] !== '**/*') {
    // Legacy mode: filter by include patterns using glob-like matching
    const { glob } = await import('glob');
    const includeMatches = new Set<string>();
    for (const pattern of include) {
      const matches = await glob(pattern, {
        cwd: root,
        nodir: true,
        absolute: false,
        dot: false,
      });
      for (const m of matches) {
        includeMatches.add(m);
      }
    }
    result = files.filter((f) => includeMatches.has(f));
  } else {
    result = files;
  }

  // Cap at max_files
  const capped = result.slice(0, indexConfig.max_files);

  // Sort for deterministic output
  return capped.sort();
}

/** Directories that are always skipped (never recurse into) */
const ALWAYS_SKIP = new Set([
  '.git',
  '.omnious',
  'node_modules',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  '.venv',
  'venv',
  '.env',
  'env',
  '.idea',
  '.vscode',
  '.vs',
  'bin',
  'obj',  // C# build output
  'target', // Java/Rust build output
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.turbo',
]);

/**
 * Create an ignore filter for a directory, loading .gitignore if present.
 */
function createIgnoreFilter(dir: string, parent?: Ignore): Ignore {
  const ig = ignore();

  // Inherit parent patterns
  if (parent) {
    // We can't directly inherit, so we pass parent separately
    // Parent filtering is handled by the caller
  }

  // Load .gitignore in this directory
  const gitignorePath = path.join(dir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      ig.add(content);
    } catch {
      // Unreadable .gitignore — skip
    }
  }

  return ig;
}

/**
 * Recursively walk a directory, collecting parseable files.
 */
function walkDir(
  dir: string,
  root: string,
  parentIgnore: Ignore,
  files: string[],
  maxFileSize: number,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or missing directory
  }

  // Check for nested .gitignore → create combined filter
  const localIgnore = createIgnoreFilter(dir);
  // We need to check against BOTH parent and local ignores

  for (const entry of entries) {
    const name = entry.name;
    const fullPath = path.join(dir, name);
    const relative = path.relative(root, fullPath);

    // Skip hidden dirs and well-known non-source directories
    if (entry.isDirectory()) {
      if (name.startsWith('.') || ALWAYS_SKIP.has(name)) continue;

      // Check if directory is ignored by gitignore
      const relDir = relative + '/';
      if (parentIgnore.ignores(relDir) || localIgnore.ignores(relDir)) continue;

      // Recurse with combined ignore
      const combinedIgnore = ignore().add(parentIgnore).add(localIgnore);
      walkDir(fullPath, root, combinedIgnore, files, maxFileSize);
      continue;
    }

    if (!entry.isFile()) continue;

    // Skip non-parseable extensions early
    if (!isParseableFile(name)) continue;

    // Check gitignore
    if (parentIgnore.ignores(relative) || localIgnore.ignores(relative)) continue;

    // Check file size
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > maxFileSize) continue;
    } catch {
      continue;
    }

    files.push(relative);
  }
}

/**
 * Scan a project root and return a summary of discovered files by language.
 * Used by `omnious init` to show what will be indexed.
 */
export function scanProject(rootDir: string): Map<string, number> {
  const counts = new Map<string, number>();
  const ig = createIgnoreFilter(rootDir);

  countFilesInDir(rootDir, rootDir, ig, counts);
  return counts;
}

function countFilesInDir(
  dir: string,
  root: string,
  parentIgnore: Ignore,
  counts: Map<string, number>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const localIgnore = createIgnoreFilter(dir);

  for (const entry of entries) {
    const name = entry.name;
    const fullPath = path.join(dir, name);
    const relative = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      if (name.startsWith('.') || ALWAYS_SKIP.has(name)) continue;
      const relDir = relative + '/';
      if (parentIgnore.ignores(relDir) || localIgnore.ignores(relDir)) continue;
      const combinedIgnore = ignore().add(parentIgnore).add(localIgnore);
      countFilesInDir(fullPath, root, combinedIgnore, counts);
      continue;
    }

    if (!entry.isFile() || !isParseableFile(name)) continue;
    if (parentIgnore.ignores(relative) || localIgnore.ignores(relative)) continue;

    const ext = path.extname(name).toLowerCase();
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
}
