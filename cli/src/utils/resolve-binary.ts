import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Resolve a local binary by checking:
 *   1) <cwd>/node_modules/.bin/<name>
 *   2) `which <name>` (Unix) / `where <name>` (Windows)
 *
 * Returns the full path if found, or `null`.
 */
export function resolveLocalBinary(
  cwd: string,
  name: string,
): string | null {
  // 1. Prefer the project-local binary
  const local = join(cwd, 'node_modules', '.bin', name);
  if (existsSync(local)) return local;

  // 2. Fall back to globally-installed binary
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    return execSync(`${whichCmd} ${name}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}
