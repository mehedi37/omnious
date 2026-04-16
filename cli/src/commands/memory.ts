/**
 * memory.ts — `omnious memory` subcommand group
 *
 * Commands:
 *   omnious memory search <query>        Search project memory palace
 *   omnious memory status                Show palace overview + stats
 *   omnious memory store <content>       Store an insight manually
 *   omnious memory context               Load wake-up context (L0+L1)
 *   omnious memory timeline <entity>     KG timeline for an entity
 */
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../config/loader.js';
import { resolveApiKey } from '../api/auth.js';
import { OmniousApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';

// ─── Shared setup ─────────────────────────────────────────────

function buildClient(opts: { apiKey?: string; apiUrl?: string; config?: string }): {
  client: OmniousApiClient;
  projectId: string;
} {
  let config;
  try {
    config = loadConfig(opts.config);
  } catch {
    // No config found — continue, user may supply --api-key
  }

  const apiKey = resolveApiKey({
    cliFlag: opts.apiKey,
    configKey: config?.api?.project_key,
  });

  if (!apiKey) {
    logger.error('No API key found. Run `omnious login` or pass --api-key.');
    process.exit(1);
  }

  const apiUrl =
    opts.apiUrl ??
    config?.api?.url ??
    process.env['OMNIOUS_API_URL'] ??
    'http://localhost:4000';

  const projectId = config?.project?.id ?? '';
  if (!projectId) {
    logger.error('No project ID found. Run `omnious init` first or check .omnious.yml.');
    process.exit(1);
  }

  return {
    client: new OmniousApiClient(apiUrl, apiKey),
    projectId,
  };
}

// ─── subcommands ──────────────────────────────────────────────

async function searchMemory(query: string, opts: { apiKey?: string; apiUrl?: string; config?: string }) {
  logger.banner();
  const { client, projectId } = buildClient(opts);
  const spinner = ora(`Searching memory for "${query}"…`).start();

  try {
    const { results } = await client.query<{ results: string }>('ai.searchMemory', {
      projectApiKey: opts.apiKey ?? '',
      projectId,
      query,
    });

    spinner.succeed('Memory search complete');
    console.log('');
    if (results.trim()) {
      console.log(results);
    } else {
      console.log('No relevant memories found for this query.');
    }
  } catch (err) {
    spinner.fail('Memory search failed');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function showStatus(opts: { apiKey?: string; apiUrl?: string; config?: string }) {
  logger.banner();
  const { client, projectId } = buildClient(opts);
  const spinner = ora('Loading memory status…').start();

  try {
    const { status } = await client.query<{ status: string }>('ai.getMemoryStats', {
      projectApiKey: opts.apiKey ?? '',
      projectId,
    });

    spinner.succeed('Memory status loaded');
    console.log('');
    console.log(status || 'Memory palace not yet initialised.');
  } catch (err) {
    spinner.fail('Failed to load memory status');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function storeInsight(
  content: string,
  opts: {
    apiKey?: string;
    apiUrl?: string;
    config?: string;
    hall?: string;
    room?: string;
  },
) {
  logger.banner();
  const { client, projectId } = buildClient(opts);
  const spinner = ora('Storing insight…').start();

  const hall = opts.hall ?? 'hall_facts';
  const room = opts.room ?? 'room_general';

  const validHalls = ['hall_facts', 'hall_events', 'hall_discoveries', 'hall_preferences', 'hall_advice'];
  if (!validHalls.includes(hall)) {
    spinner.fail(`Invalid hall. Must be one of: ${validHalls.join(', ')}`);
    process.exit(1);
  }

  try {
    await client.mutate('ai.addMemoryInsight', {
      projectApiKey: opts.apiKey ?? '',
      projectId,
      content,
      hall,
      room,
    });

    spinner.succeed(`Stored in \`${hall}/${room}\``);
    console.log('');
    logger.info(`Content: "${content.slice(0, 100)}${content.length > 100 ? '…' : ''}"`)
  } catch (err) {
    spinner.fail('Failed to store insight');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function showContext(opts: { apiKey?: string; apiUrl?: string; config?: string }) {
  logger.banner();
  const { client, projectId } = buildClient(opts);
  const spinner = ora('Loading memory context…').start();

  try {
    const { context } = await client.query<{ context: string }>('ai.getMemoryContext', {
      projectApiKey: opts.apiKey ?? '',
      projectId,
    });

    spinner.succeed('Memory context loaded');
    console.log('');
    console.log(context || 'Memory context not yet available. Use `omnious sync` to populate it.');
  } catch (err) {
    spinner.fail('Failed to load memory context');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function showTimeline(entity: string, opts: { apiKey?: string; apiUrl?: string; config?: string }) {
  logger.banner();
  const { client, projectId } = buildClient(opts);
  const spinner = ora(`Loading timeline for "${entity}"…`).start();

  try {
    const { timeline } = await client.query<{ timeline: unknown[] }>('ai.getKnowledgeTimeline', {
      projectApiKey: opts.apiKey ?? '',
      projectId,
      entity,
    });

    spinner.succeed('Timeline loaded');
    console.log('');

    if (!timeline || timeline.length === 0) {
      console.log(`No timeline entries found for "${entity}".`);
    } else {
      console.log(`Timeline for: ${entity}\n`);
      for (const entry of timeline) {
        console.log(JSON.stringify(entry, null, 2));
      }
    }
  } catch (err) {
    spinner.fail('Failed to load timeline');
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// ─── Export the command ───────────────────────────────────────

export function memoryCommand(): Command {
  const memory = new Command('memory')
    .description('Manage the AI memory palace for your project')
    .addHelpText('after', `
Examples:
  $ omnious memory search "why did we switch to Postgres"
  $ omnious memory store "Decided to use Row Level Security for all user tables (2026-03)"
  $ omnious memory store "auth rework" --hall hall_events --room auth-migration
  $ omnious memory context
  $ omnious memory timeline "AuthService"
  $ omnious memory status
  `);

  memory
    .command('search <query>')
    .description('Search the project memory palace for relevant context')
    .option('--api-key <key>', 'Project API key')
    .option('--api-url <url>', 'API URL override')
    .option('-c, --config <path>', 'Path to .omnious.yml')
    .action(async (query: string, opts) => {
      await searchMemory(query, opts);
    });

  memory
    .command('status')
    .description('Show memory palace overview and statistics')
    .option('--api-key <key>', 'Project API key')
    .option('--api-url <url>', 'API URL override')
    .option('-c, --config <path>', 'Path to .omnious.yml')
    .action(async (opts) => {
      await showStatus(opts);
    });

  memory
    .command('store <content>')
    .description('Manually store an insight into the memory palace')
    .option('--hall <hall>', 'Memory hall: hall_facts, hall_events, hall_discoveries, hall_preferences, hall_advice', 'hall_facts')
    .option('--room <room>', 'Room within the hall (e.g., "auth-migration")', 'room_general')
    .option('--api-key <key>', 'Project API key')
    .option('--api-url <url>', 'API URL override')
    .option('-c, --config <path>', 'Path to .omnious.yml')
    .action(async (content: string, opts) => {
      await storeInsight(content, opts);
    });

  memory
    .command('context')
    .description('Show the L0+L1 wake-up context for this project (~170 tokens)')
    .option('--api-key <key>', 'Project API key')
    .option('--api-url <url>', 'API URL override')
    .option('-c, --config <path>', 'Path to .omnious.yml')
    .action(async (opts) => {
      await showContext(opts);
    });

  memory
    .command('timeline <entity>')
    .description('Show the knowledge graph timeline for an entity (person, module, feature)')
    .option('--api-key <key>', 'Project API key')
    .option('--api-url <url>', 'API URL override')
    .option('-c, --config <path>', 'Path to .omnious.yml')
    .action(async (entity: string, opts) => {
      await showTimeline(entity, opts);
    });

  return memory;
}
