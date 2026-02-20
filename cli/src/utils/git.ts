import { execSync } from 'node:child_process';

export interface GitContext {
  commit_hash?: string;
  branch?: string;
  author_email?: string;
  commit_message?: string;
}

/**
 * Capture git context from the current working directory.
 * Returns empty fields if git is unavailable.
 */
export function getGitContext(cwd?: string): GitContext {
  const opts = { cwd: cwd ?? process.cwd(), encoding: 'utf-8' as const };
  const ctx: GitContext = {};

  try {
    const log = execSync(
      'git log -1 --format="%H|%s|%ae"',
      opts,
    ).trim();
    const [hash, message, email] = log.split('|');
    if (hash) ctx.commit_hash = hash;
    if (message) ctx.commit_message = message;
    if (email) ctx.author_email = email;
  } catch {
    // git not available or not a git repo — skip
  }

  try {
    ctx.branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
  } catch {
    // skip
  }

  return ctx;
}

/**
 * Check if we're in a git repository
 */
export function isGitRepo(cwd?: string): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}
