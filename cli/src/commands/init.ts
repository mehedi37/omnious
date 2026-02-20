import fs from 'node:fs';
import path from 'node:path';
import { input, confirm, select } from '@inquirer/prompts';
import { defaultConfigYaml } from '../config/schema.js';
import { findConfigPath } from '../config/loader.js';
import { detectLanguages } from '../parsers/registry.js';
import { logger } from '../utils/logger.js';

interface InitOptions {
  yes?: boolean;
  apiUrl?: string;
  projectKey?: string;
}

/**
 * `omnious init` — initialize .omnious.yml in the current directory
 */
export async function initCommand(opts: InitOptions): Promise<void> {
  const cwd = process.cwd();

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

  // Detect languages
  const languages = detectLanguages(cwd);
  if (languages.length > 0) {
    logger.dim(`Detected languages: ${languages.join(', ')}`);
  }

  // Build include patterns based on detected languages
  const includePatterns = buildIncludePatterns(languages);

  let apiUrl = opts.apiUrl ?? 'http://localhost:4000';
  let projectKey = opts.projectKey ?? '';

  // Interactive mode
  if (!opts.yes) {
    apiUrl = await input({
      message: 'API URL:',
      default: apiUrl,
    });

    projectKey = await input({
      message: 'Project API key (or press enter to skip):',
      default: projectKey,
    });

    const includeChoice = await select({
      message: 'Index patterns:',
      choices: [
        {
          name: `Auto-detected (${includePatterns.join(', ')})`,
          value: 'auto',
        },
        { name: 'Custom', value: 'custom' },
      ],
    });

    if (includeChoice === 'custom') {
      const customPatterns = await input({
        message: 'Glob patterns (comma-separated):',
        default: includePatterns.join(', '),
      });
      includePatterns.length = 0;
      includePatterns.push(
        ...customPatterns.split(',').map((p) => p.trim()),
      );
    }
  }

  // Generate config YAML
  const yaml = defaultConfigYaml({
    apiUrl,
    projectKey: projectKey || undefined,
    include: includePatterns,
  });

  // Write .omnious.yml
  const configPath = path.join(cwd, '.omnious.yml');
  fs.writeFileSync(configPath, yaml, 'utf-8');
  logger.success(`Created ${path.relative(cwd, configPath)}`);

  // Create .omnious/ directory for local cache
  const cacheDir = path.join(cwd, '.omnious');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // Add .omnious/ to .gitignore if not already there
  await ensureGitignore(cwd);

  logger.info('');
  logger.info('Next steps:');
  if (!projectKey) {
    logger.info('  1. Set your project API key:');
    logger.info('     export OMNIOUS_PROJECT_KEY=<your-key>');
    logger.info('  2. Index your codebase:');
    logger.info('     omnious index');
  } else {
    logger.info('  1. Index your codebase:');
    logger.info('     omnious index');
  }
  logger.info('  → Push to Omnious:');
  logger.info('     omnious push');
}

function buildIncludePatterns(languages: string[]): string[] {
  const patterns: string[] = [];

  if (
    languages.includes('typescript') ||
    languages.includes('javascript') ||
    languages.length === 0
  ) {
    patterns.push('src/**/*.{ts,tsx,js,jsx}');
  }

  if (languages.includes('python')) {
    patterns.push('**/*.py');
  }

  // Default fallback
  if (patterns.length === 0) {
    patterns.push('src/**/*.{ts,tsx,js,jsx}');
  }

  return patterns;
}

async function ensureGitignore(cwd: string): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  const entry = '.omnious/';

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes(entry)) {
      fs.appendFileSync(gitignorePath, `\n# Omnious local cache\n${entry}\n`);
      logger.dim('Added .omnious/ to .gitignore');
    }
  } else {
    fs.writeFileSync(
      gitignorePath,
      `# Omnious local cache\n${entry}\n`,
      'utf-8',
    );
    logger.dim('Created .gitignore with .omnious/ entry');
  }
}
