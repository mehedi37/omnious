import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { loginCommand } from '../src/commands/login.js';
import { indexCommand } from '../src/commands/index.js';
import { pushCommand } from '../src/commands/push.js';
import { statusCommand } from '../src/commands/status.js';

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
  .option('--api-url <url>', 'API URL')
  .option('--project-key <key>', 'Project API key')
  .action(async (opts) => {
    await initCommand({
      yes: opts.yes,
      apiUrl: opts.apiUrl,
      projectKey: opts.projectKey,
    });
  });

// ── omnious login ──
program
  .command('login')
  .description('Authenticate with your project API key')
  .option('--api-key <key>', 'API key (or enter interactively)')
  .option('--api-url <url>', 'API URL override')
  .option('--logout', 'Remove stored credentials')
  .option('--status', 'Show current auth status')
  .action(async (opts) => {
    await loginCommand({
      apiKey: opts.apiKey,
      apiUrl: opts.apiUrl,
      logout: opts.logout,
      status: opts.status,
    });
  });

// ── omnious index ──
program
  .command('index')
  .description('Parse the codebase and build local OIR graph')
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
  .description('Upload OIR graph to the Omnious backend')
  .option('--api-key <key>', 'Project API key')
  .option('-c, --config <path>', 'Path to .omnious.yml')
  .option('--force', 'Push even if project hash is unchanged')
  .option('--dry-run', 'Show what would be pushed without sending')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (opts) => {
    await pushCommand({
      apiKey: opts.apiKey,
      config: opts.config,
      force: opts.force,
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
