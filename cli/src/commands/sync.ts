import { indexCommand } from './index.js';
import { pushCommand } from './push.js';
import { logger } from '../utils/logger.js';

interface SyncOptions {
  apiKey?: string;
  config?: string;
  force?: boolean;
  verbose?: boolean;
}

/**
 * `omnious sync` — parse the codebase then push to the backend in one step.
 *
 * Equivalent to running `omnious index` followed by `omnious push`.
 * Use this as the primary workflow command.
 */
export async function syncCommand(opts: SyncOptions): Promise<void> {
  logger.banner();
  console.log('');
  logger.dim('  Running index + push in sequence…');
  console.log('');

  // Step 1: Index (parse codebase → write .omnious/index.json)
  await indexCommand({
    config: opts.config,
    verbose: opts.verbose,
    force: opts.force,
    _skipBanner: true,
  });

  // Bail if indexing failed
  if (process.exitCode && process.exitCode !== 0) return;

  console.log('');

  // Step 2: Push (upload index.json to backend)
  await pushCommand({
    apiKey: opts.apiKey,
    config: opts.config,
    force: opts.force,
    verbose: opts.verbose,
    _skipBanner: true,
  });
}
