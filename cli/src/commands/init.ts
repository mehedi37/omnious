import fs from 'node:fs';
import path from 'node:path';
import { input, confirm } from '@inquirer/prompts';
import ora from 'ora';
import { defaultConfigYaml } from '../config/schema.js';
import { findConfigPath } from '../config/loader.js';
import { saveCredentials } from '../api/auth.js';
import { detectStack, type DetectionResult } from '../parsers/detect-stack.js';
import { scanProject } from '../utils/fs.js';
import { LANGUAGE_DISPLAY_NAMES, type SupportedLanguage } from '../parsers/languages.js';
import { OmniousApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';

declare const __OMNIOUS_PROD_URL__: string;

/** Check if a production API URL is baked in at build time */
function getProdUrl(): string | undefined {
  try {
    return typeof __OMNIOUS_PROD_URL__ === 'string' && __OMNIOUS_PROD_URL__.length > 0
      ? __OMNIOUS_PROD_URL__
      : undefined;
  } catch {
    return undefined;
  }
}

interface InitOptions {
  yes?: boolean;
  apiUrl?: string;
  projectKey?: string;
  link?: string;
}

/**
 * `omnious init` — initialize .omnious.yml in the current directory
 *
 * Scans the project, shows a language breakdown, and writes a minimal config.
 * Zero-config by default — gitignore-first discovery needs no include patterns.
 */
export async function initCommand(opts: InitOptions): Promise<void> {
  const cwd = process.cwd();
  logger.banner();
  console.log('');

  // ── --link shortcut: validate key, auto-write full config ──
  if (opts.link) {
    return linkProject(cwd, opts);
  }

  // Check if config already exists
  const existing = findConfigPath(cwd);
  if (existing) {
    const rel = path.relative(cwd, existing);
    if (!opts.yes) {
      const overwrite = await confirm({
        message: `Config already exists at ${rel}. Overwrite?`,
        default: false,
      });
      if (!overwrite) {
        logger.info('Aborted.');
        return;
      }
    } else {
      logger.warn(`Overwriting existing config at ${rel}`);
    }
  }

  // Scan project for parseable files
  logger.step('Scanning project…');
  const fileCounts = scanProject(cwd);
  const totalFiles = [...fileCounts.values()].reduce((a, b) => a + b, 0);

  if (totalFiles === 0) {
    logger.warn('No parseable source files found in this directory.');
    logger.dim('  Supported: .ts, .tsx, .js, .jsx, .py, .go, .java, .cs');
    logger.dim('  Make sure you\'re in the project root and .gitignore isn\'t too aggressive.');
  } else {
    printFileSummary(fileCounts, totalFiles);
  }

  // Detect stack (frameworks, monorepo)
  const detection = detectStack(cwd);
  printDetection(detection);

  // Resolve API URL — use prod URL if baked in, otherwise prompt
  const prodUrl = getProdUrl();
  let apiUrl = opts.apiUrl ?? prodUrl ?? 'http://localhost:4000';
  let projectKey = opts.projectKey ?? '';

  // Interactive mode
  if (!opts.yes) {
    // Only prompt for API URL if no production URL is baked in
    if (!prodUrl) {
      apiUrl = await input({
        message: 'API URL:',
        default: apiUrl,
      });
    }

    projectKey = await input({
      message: 'Project API key (or press enter to skip):',
      default: projectKey,
    });
  }

  // Generate config YAML (no include patterns — gitignore-first!)
  const yaml = defaultConfigYaml({
    apiUrl,
    projectKey: projectKey || undefined,
  });

  // Write .omnious.yml
  const configPath = path.join(cwd, '.omnious.yml');
  fs.writeFileSync(configPath, yaml, 'utf-8');

  // Create .omnious/ directory for local cache
  const cacheDir = path.join(cwd, '.omnious');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Add .omnious/ to .gitignore if not already there
  await ensureGitignore(cwd);

  // Success output
  const summaryLines = [
    `Config created at ${logger.theme.accent(path.relative(cwd, configPath))}`,
    '',
    `${logger.label('Discovery')} gitignore-first (zero config)`,
    `${logger.label('Files')} ${totalFiles} parseable files found`,
  ];
  if (!prodUrl) {
    summaryLines.push(`${logger.label('API URL')} ${apiUrl}`);
  }
  if (projectKey) {
    summaryLines.push(`${logger.label('API Key')} ${'*'.repeat(4)}...${projectKey.slice(-4)}`);
  }
  logger.successBox(summaryLines, '✔ Initialized');

  // Next steps
  const steps: string[] = [];
  if (!projectKey) {
    steps.push(`${logger.theme.muted('1.')} Set your project API key:`);
    steps.push(`   ${logger.theme.accent('export OMNIOUS_PROJECT_KEY=<your-key>')}`);
    steps.push(`${logger.theme.muted('2.')} Index your codebase:`);
    steps.push(`   ${logger.theme.accent('omnious index')}`);
  } else {
    steps.push(`${logger.theme.muted('1.')} Index your codebase:`);
    steps.push(`   ${logger.theme.accent('omnious index')}`);
  }
  steps.push(`${logger.theme.muted('→')} Push to Omnious:`);
  steps.push(`   ${logger.theme.accent('omnious push')}`);

  logger.infoBox(steps, 'Next Steps');
}

/** Print parseable file summary by extension */
function printFileSummary(counts: Map<string, number>, total: number): void {
  // Group extensions by language
  const byLang = new Map<string, number>();
  const extToLang: Record<string, SupportedLanguage> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'typescript',
    '.jsx': 'typescript', '.mjs': 'typescript', '.cjs': 'typescript',
    '.mts': 'typescript', '.cts': 'typescript',
    '.py': 'python', '.pyi': 'python', '.pyw': 'python',
    '.go': 'go',
    '.java': 'java',
    '.cs': 'csharp',
  };

  for (const [ext, count] of counts) {
    const lang = extToLang[ext] ?? ext;
    byLang.set(lang, (byLang.get(lang) ?? 0) + count);
  }

  logger.section('Language Breakdown');
  const sorted = [...byLang.entries()].sort((a, b) => b[1] - a[1]);
  for (const [lang, count] of sorted) {
    const displayName = LANGUAGE_DISPLAY_NAMES[lang as SupportedLanguage] ?? lang;
    const pct = ((count / total) * 100).toFixed(0);
    const bar = '█'.repeat(Math.max(1, Math.round((count / total) * 20)));
    logger.kv(displayName, `${logger.theme.brand(String(count))} files ${logger.theme.muted(`(${pct}%)`)} ${logger.theme.muted(bar)}`);
  }
  console.log('');
}

/** Print a summary of what was detected */
function printDetection(det: DetectionResult): void {
  const parts: string[] = [];

  if (det.frameworks.length > 0) {
    parts.push(det.frameworks.map(formatFramework).join(', '));
  }
  if (det.hasTypeScript) {
    parts.push('TypeScript');
  } else if (det.languages.length > 0) {
    parts.push(det.languages.join(', '));
  }
  if (det.isMonorepo) {
    parts.push('monorepo');
  }

  if (parts.length > 0) {
    logger.step(`Detected: ${logger.theme.brand(parts.join(' · '))}`);
  }
}

/** Prettify framework names for display */
function formatFramework(fw: string): string {
  const names: Record<string, string> = {
    // JS/TS
    nextjs: 'Next.js',
    react: 'React',
    vue: 'Vue',
    svelte: 'Svelte',
    astro: 'Astro',
    angular: 'Angular',
    remix: 'Remix',
    express: 'Express',
    fastify: 'Fastify',
    nestjs: 'NestJS',
    electron: 'Electron',
    hono: 'Hono',
    elysia: 'Elysia',
    // Go
    gin: 'Gin',
    echo: 'Echo',
    fiber: 'Fiber',
    chi: 'Chi',
    mux: 'Gorilla Mux',
    gorm: 'GORM',
    ent: 'Ent',
    cobra: 'Cobra',
    // Python
    django: 'Django',
    fastapi: 'FastAPI',
    flask: 'Flask',
    starlette: 'Starlette',
    tornado: 'Tornado',
    sanic: 'Sanic',
    scrapy: 'Scrapy',
    sqlalchemy: 'SQLAlchemy',
    celery: 'Celery',
    pytest: 'pytest',
    // Java
    'spring-boot': 'Spring Boot',
    quarkus: 'Quarkus',
    micronaut: 'Micronaut',
    vertx: 'Vert.x',
    'jakarta-ee': 'Jakarta EE',
    // C#
    aspnet: 'ASP.NET Core',
    efcore: 'EF Core',
    blazor: 'Blazor',
    maui: 'MAUI',
    'avalonia-ui': 'Avalonia UI',
    // Rust
    axum: 'Axum',
    'actix-web': 'Actix Web',
    rocket: 'Rocket',
    warp: 'Warp',
    tokio: 'Tokio',
    diesel: 'Diesel',
    sqlx: 'SQLx',
    serde: 'Serde',
    // PHP
    laravel: 'Laravel',
    symfony: 'Symfony',
    slim: 'Slim',
    codeigniter: 'CodeIgniter',
    wordpress: 'WordPress',
    // Ruby
    rails: 'Rails',
    sinatra: 'Sinatra',
    hanami: 'Hanami',
    grape: 'Grape',
    jekyll: 'Jekyll',
  };
  return names[fw] ?? fw;
}

/**
 * `omnious init --link <api-key>` — validate key, fetch project info, write config.
 */
async function linkProject(cwd: string, opts: InitOptions): Promise<void> {
  const spinner = ora({ isSilent: !!process.env['CI'] });

  // Resolve API URL
  const prodUrl = getProdUrl();
  const apiUrl = opts.apiUrl ?? prodUrl ?? 'http://localhost:4000';
  const apiKey = opts.link!;

  // Validate key against backend
  spinner.start('Validating API key…');
  const client = new OmniousApiClient(apiUrl, apiKey);

  let status: Awaited<ReturnType<OmniousApiClient['getProjectStatus']>>;
  try {
    status = await client.getProjectStatus();
    spinner.succeed(`Found project: ${logger.theme.brand(status.name)}`);
    // Save credentials so `omnious push` works without OMNIOUS_PROJECT_KEY env var
    saveCredentials({ api_key: apiKey, api_url: apiUrl });
  } catch (err) {
    spinner.fail('Invalid API key or cannot reach backend');
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    process.exitCode = 1;
    return;
  }

  // Scan project for stats
  logger.step('Scanning project…');
  const fileCounts = scanProject(cwd);
  const totalFiles = [...fileCounts.values()].reduce((a, b) => a + b, 0);

  if (totalFiles > 0) {
    printFileSummary(fileCounts, totalFiles);
  }

  const detection = detectStack(cwd);
  printDetection(detection);

  // Write config with full project info
  const yaml = defaultConfigYaml({
    apiUrl,
    projectKey: apiKey,
    projectId: status.id,
    projectName: status.name,
    slug: status.slug,
    workspaceSlug: status.workspace_slug ?? undefined,
  });

  const configPath = path.join(cwd, '.omnious.yml');
  fs.writeFileSync(configPath, yaml, 'utf-8');

  // Create .omnious/ directory for local cache
  const cacheDir = path.join(cwd, '.omnious');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  await ensureGitignore(cwd);

  // Summary
  const summaryLines = [
    `Linked to ${logger.theme.brand(status.name)} ${logger.theme.muted(`(${status.slug})`)}`,
    '',
    `${logger.label('Project ID')} ${status.id}`,
  ];
  if (status.workspace_slug) {
    summaryLines.push(`${logger.label('Workspace')} ${status.workspace_slug}`);
  }
  if (!prodUrl) {
    summaryLines.push(`${logger.label('API URL')} ${apiUrl}`);
  }
  summaryLines.push(`${logger.label('Files')} ${totalFiles} parseable files found`);
  summaryLines.push(`${logger.label('Key saved')} ${logger.theme.muted('~/.omnious/credentials.json')}`);
  logger.successBox(summaryLines, '✔ Project Linked');

  // Next steps
  logger.infoBox([
    `${logger.theme.muted('1.')} Index your codebase:`,
    `   ${logger.theme.accent('omnious index')}`,
    `${logger.theme.muted('2.')} Push to Omnious:`,
    `   ${logger.theme.accent('omnious push')}`,
  ], 'Next Steps');
}

async function ensureGitignore(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = '.omnious/';

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes(entry)) {
      fs.appendFileSync(gitignorePath, `\n# Omnious local cache\n${entry}\n`);
      logger.dim('  Added .omnious/ to .gitignore');
    }
  } else {
    fs.writeFileSync(
      gitignorePath,
      `# Omnious local cache\n${entry}\n`,
      'utf-8',
    );
    logger.dim('  Created .gitignore with .omnious/ entry');
  }
}
