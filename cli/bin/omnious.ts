import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { loginCommand } from '../src/commands/login.js';
import { indexCommand } from '../src/commands/index.js';
import { pushCommand } from '../src/commands/push.js';
import { syncCommand } from '../src/commands/sync.js';
import { statusCommand } from '../src/commands/status.js';
import { configCommand } from '../src/commands/config.js';
import { summarizeCommand } from '../src/commands/summarize.js';
import { reportErrorCommand } from '../src/commands/report-error.js';
import { memoryCommand } from '../src/commands/memory.js';

const program = new Command();

program
  .name('omnious')
  .description('Omnious CLI — code intelligence from your terminal')
  .version('0.1.0');

// ── omnious init ──
program
  .command('init')
  .description('Initialize .omnious.yml in the current directory')
  .option('-y, --yes', 'Accept all defaults (non-interactive)')
  .option('-i, --interactive', 'Interactive mode: select workspace and create project')
  .option('--api-url <url>', 'API URL')
  .option('--project-key <key>', 'Project API key')
  .option('--link <apiKey>', 'Auto-link project using an API key')
  .action(async (opts) => {
    await initCommand({
      yes: opts.yes,
      interactive: opts.interactive,
      apiUrl: opts.apiUrl,
      projectKey: opts.projectKey,
      link: opts.link,
    });
  });

// ── omnious login ──
program
  .command('login')
  .description('Authenticate with your project API key or via browser')
  .option('--api-key <key>', 'API key (or enter interactively)')
  .option('--api-url <url>', 'API URL override')
  .option('-b, --browser', 'Log in via browser (Device Flow)')
  .option('--logout', 'Remove stored credentials')
  .option('--status', 'Show current auth status')
  .action(async (opts) => {
    await loginCommand({
      apiKey: opts.apiKey,
      apiUrl: opts.apiUrl,
      browser: opts.browser,
      logout: opts.logout,
      status: opts.status,
    });
  });

// ── omnious sync ──
program
  .command('sync')
  .description('Recommended: scan, index, and push your codebase in one step')
  .option('--api-key <key>', 'Project API key')
  .option('-c, --config <path>', 'Path to .omnious.yml')
  .option('--force', 'Re-parse and re-push even if nothing changed')
  .option('-v, --verbose', 'Show detailed output')
  .option('--skip-summarize', 'Skip the manifest scan and context upload step')
  .action(async (opts) => {
    await syncCommand({
      apiKey: opts.apiKey,
      config: opts.config,
      force: opts.force,
      verbose: opts.verbose,
      skipSummarize: opts.skipSummarize,
    });
  });

// ── omnious index ──
program
  .command('index')
  .description('Advanced: parse codebase and build local OIR graph (use `sync` for most cases)')
  .option('-c, --config <path>', 'Path to .omnious.yml')
  .option('-v, --verbose', 'Show detailed output')
  .option('--dry-run', 'Parse without writing index file')
  .option('--force', 'Re-parse all files (ignore cache)')
  .action(async (opts) => {
    await indexCommand({
      config: opts.config,
      verbose: opts.verbose,
      dryRun: opts.dryRun,
      force: opts.force,
    });
  });

// ── omnious push ──
program
  .command('push')
  .description('Advanced: upload OIR graph to the backend (use `sync` for most cases)')
  .option('--api-key <key>', 'Project API key')
  .option('-c, --config <path>', 'Path to .omnious.yml')
  .option('--force', 'Push even if project hash is unchanged')
  .option('--clean', 'Wipe local push state and do a full re-push')
  .option('--dry-run', 'Show what would be pushed without sending')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (opts) => {
    await pushCommand({
      apiKey: opts.apiKey,
      config: opts.config,
      force: opts.force,
      clean: opts.clean,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
    });
  });

// ── omnious status ──
program
  .command('status')
  .description('Show local index and sync status')
  .option('-c, --config <path>', 'Path to .omnious.yml')
  .option('--api-key <key>', 'Project API key')
  .option('-r, --remote', 'Also fetch remote project status')
  .action(async (opts) => {
    await statusCommand({
      config: opts.config,
      apiKey: opts.apiKey,
      remote: opts.remote,
    });
  });

// ── omnious summarize ──
program
  .command('summarize')
  .description('Advanced: scan project manifests and generate context metadata (auto-runs in `sync`)')
  .option('-c, --config <path>', 'Path to .omnious.yml')
  .option('-v, --verbose', 'Show full context JSON')
  .action(async (opts) => {
    await summarizeCommand({
      config: opts.config,
      verbose: opts.verbose,
    });
  });

// ── omnious error (primary) + report-error (hidden alias for backwards compat) ──
program
  .command('error')
  .description('Report a runtime error (from file or stdin) and map it to the code graph')
  .option('-f, --file <path>', 'Read error from a file')
  .option('-t, --type <type>', 'Override error type (e.g. TypeError)')
  .option('-s, --severity <severity>', 'Error severity: error, warning, info', 'error')
  .option('-k, --api-key <key>', 'Project API key')
  .option('-c, --config <path>', 'Path to .omnious.yml')
  .option('-v, --verbose', 'Show parsed stack frames')
  .action(async (opts) => {
    await reportErrorCommand({
      file: opts.file,
      type: opts.type,
      severity: opts.severity,
      apiKey: opts.apiKey,
      config: opts.config,
      verbose: opts.verbose,
    });
  });

program
  .command('report-error', { hidden: true })
  .description('Alias for `error` (deprecated name)')
  .option('-f, --file <path>', 'Read error from a file')
  .option('-t, --type <type>', 'Override error type')
  .option('-s, --severity <severity>', 'Error severity', 'error')
  .option('-k, --api-key <key>', 'Project API key')
  .option('-c, --config <path>', 'Path to .omnious.yml')
  .option('-v, --verbose', 'Show parsed stack frames')
  .action(async (opts) => {
    await reportErrorCommand({
      file: opts.file,
      type: opts.type,
      severity: opts.severity,
      apiKey: opts.apiKey,
      config: opts.config,
      verbose: opts.verbose,
    });
  });

// ── omnious config ──
const configCmd = program
  .command('config')
  .description('View or modify .omnious.yml settings');

configCmd
  .command('list')
  .description('Show all configuration values')
  .action(async () => {
    await configCommand({ action: 'list' });
  });

configCmd
  .command('get <key>')
  .description('Get a configuration value (e.g. api.url)')
  .action(async (key: string) => {
    await configCommand({ action: 'get', key });
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (e.g. api.url https://api.omnious.dev)')
  .action(async (key: string, value: string) => {
    await configCommand({ action: 'set', key, value });
  });

// ── omnious memory ──
program.addCommand(memoryCommand().description('Query and manage your project AI memory'));

// ── Parse errors gracefully ──
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  if (err instanceof Error && 'code' in err) {
    const code = (err as { code: string }).code;
    // Commander throws on --help and --version with exitCode 0
    if (code === 'commander.helpDisplayed' || code === 'commander.version') {
      process.exit(0);
    }
  }
  // Unhandled error
  console.error(
    err instanceof Error ? err.message : 'An unexpected error occurred',
  );
  process.exit(1);
}
