import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Load root monorepo .env (../.. from src/config/ = monorepo root)
// Falls back to a local .env in cwd for overrides or standalone runs.
const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, '../../../.env');
const localEnv = resolve(process.cwd(), '.env');
if (existsSync(rootEnv)) {
  dotenvConfig({ path: rootEnv });
} else if (existsSync(localEnv)) {
  dotenvConfig({ path: localEnv });
}

/**
 * Environment variable schema — validated at startup.
 * If any required var is missing, the server refuses to start.
 */
const envSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),

  // AI — Platform keys (optional: enables free tier for users without BYOK keys)
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // API Key Encryption — required for BYOK encrypted storage (AES-256-GCM)
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  API_KEY_ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-f]+$/i, 'Must be 64 hex chars'),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error(
      '❌  Invalid environment variables:\n',
      result.error.flatten().fieldErrors,
    );
    process.exit(1);
  }
  return result.data;
}

/** Validated, typed environment — import from anywhere. */
export const env = loadEnv();
