import { indexCommand } from './index.js';
import { pushCommand } from './push.js';
import { extractProjectContext } from './summarize.js';
import { loadConfig } from '../config/loader.js';
import { resolveApiKey } from '../api/auth.js';
import { OmniousApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';

interface SyncOptions {
  apiKey?: string;
  config?: string;
  force?: boolean;
  verbose?: boolean;
  /** Skip the manifest scan + context upload step */
  skipSummarize?: boolean;
}

/**
 * `omnious sync` — scan, index, and push your codebase in one step.
 *
 * Runs: manifest scan → upload project context → index → push.
 * Use this as the primary workflow command.
 */
export async function syncCommand(opts: SyncOptions): Promise<void> {
  logger.banner();
  console.log('');
  logger.dim('  Running sync…');
  console.log('');

  // Step 0: Upload project context (languages, frameworks, entry points, domains)
  if (!opts.skipSummarize) {
    try {
      const cwd = process.cwd();
      const config = loadConfig(opts.config);
      const apiKey = resolveApiKey({ cliFlag: opts.apiKey, configKey: config.api.project_key });

      if (apiKey && config.api.url) {
        const context = await extractProjectContext(cwd);
        const content = [
          `# Project: ${context.name}`,
          context.description ? `\n${context.description}` : '',
          `\n**Languages:** ${context.languages.join(', ') || 'unknown'}`,
          `**Frameworks:** ${context.frameworks.join(', ') || 'none'}`,
          `**Build Tools:** ${context.buildTools.join(', ') || 'none'}`,
          context.entryPoints.length > 0 ? `**Entry Points:** ${context.entryPoints.join(', ')}` : '',
          context.domains.length > 0 ? `**Domains:** ${context.domains.join(', ')}` : '',
          `\n_Generated: ${context.generatedAt}_`,
        ].filter(Boolean).join('\n');

        const client = new OmniousApiClient(config.api.url, apiKey);
        await client.pushDocuments([{
          path: '__omnious_context__',
          content,
          doc_type: 'context_metadata',
        }]);

        if (opts.verbose) {
          logger.dim('  Uploaded project context metadata');
        }
      }
    } catch {
      // Non-fatal — proceed without context upload
    }
  }

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
