import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { configSchema, type OmniousConfig } from './schema.js';

const CONFIG_FILENAME = '.omnious.yml';

/**
 * Walk up directory tree to find .omnious.yml
 */
export function findConfigPath(startDir?: string): string | null {
  let dir = startDir ?? process.cwd();

  while (true) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  return null;
}

/**
 * Resolve ${ENV_VAR} references in string values
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
    return process.env[varName] ?? '';
  });
}

/**
 * Recursively resolve env vars in an object
 */
function resolveEnvVarsDeep(obj: unknown): unknown {
  if (typeof obj === 'string') return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(resolveEnvVarsDeep);
  if (obj != null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVarsDeep(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load and validate .omnious.yml config
 */
export function loadConfig(configPath?: string): OmniousConfig {
  const resolvedPath = configPath ?? findConfigPath();

  if (!resolvedPath) {
    throw new Error(
      'No .omnious.yml found in current directory or parents.\n' +
        'Run `omnious init` to set up your project.',
    );
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYaml(raw);
  const resolved = resolveEnvVarsDeep(parsed);

  const result = configSchema.safeParse(resolved);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid .omnious.yml:\n${issues}`);
  }

  // Override with environment variables (CI mode)
  const config = result.data;

  if (process.env['OMNIOUS_PROJECT_KEY']) {
    config.api.project_key = process.env['OMNIOUS_PROJECT_KEY'];
  }
  if (process.env['OMNIOUS_API_URL']) {
    config.api.url = process.env['OMNIOUS_API_URL'];
  }

  return config;
}
