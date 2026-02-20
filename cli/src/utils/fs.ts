import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import ignore from 'ignore';
import type { OmniousConfig } from '../config/schema.js';

/**
 * Walk the file tree respecting .gitignore + config include/exclude patterns.
 * Returns array of relative file paths.
 */
export async function walkFiles(
  config: OmniousConfig,
  rootDir?: string,
): Promise<string[]> {
  const root = rootDir ?? process.cwd();
  const indexConfig = config.index;

  // Load .gitignore if it exists
  const ig = ignore();
  const gitignorePath = path.join(root, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    ig.add(gitignoreContent);
  }

  // Always ignore .omnious/ directory
  ig.add('.omnious/');

  // Expand include globs
  const includePatterns = indexConfig.include;
  const allFiles: string[] = [];

  for (const pattern of includePatterns) {
    const matches = await glob(pattern, {
      cwd: root,
      nodir: true,
      absolute: false,
      dot: false,
      ignore: indexConfig.exclude,
    });
    allFiles.push(...matches);
  }

  // Deduplicate
  const uniqueFiles = [...new Set(allFiles)];

  // Apply .gitignore filter
  const filtered = ig.filter(uniqueFiles);

  // Filter by file size
  const maxSize = indexConfig.max_file_size;
  const sizeFiltered = filtered.filter((file: string) => {
    try {
      const stat = fs.statSync(path.join(root, file));
      return stat.size <= maxSize;
    } catch {
      return false;
    }
  });

  // Cap at max_files
  const capped = sizeFiltered.slice(0, indexConfig.max_files);

  // Sort for deterministic output
  return capped.sort();
}
