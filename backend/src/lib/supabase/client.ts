import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env.js';
import type { Database } from './database.types.js';

/**
 * Admin client — uses SERVICE_ROLE key.
 * Bypasses RLS. Use ONLY in trusted server-side contexts
 * (cron jobs, webhooks, system operations).
 *
 * ⚠️  NEVER expose to user-facing code paths.
 */
export const supabaseAdmin: SupabaseClient<Database> = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: { schema: 'public' },
  },
);

/**
 * Create a per-request Supabase client that impersonates the
 * authenticated user. This client respects RLS policies.
 *
 * Pass the user's JWT from the Authorization header.
 */
export function createUserClient(
  accessToken: string,
): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: { schema: 'public' },
  });
}

export type { Database };
