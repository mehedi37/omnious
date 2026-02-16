import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { createClient, type User } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { createUserClient, supabaseAdmin } from '../lib/supabase/client.js';
import type { Database } from '../lib/supabase/database.types.js';

export interface Context {
  /** The Fastify request (for headers, IP, etc.) */
  req: CreateFastifyContextOptions['req'];
  /** The Fastify response */
  res: CreateFastifyContextOptions['res'];
  /** Authenticated Supabase user (null if unauthenticated) */
  user: User | null;
  /** Access token extracted from Authorization header */
  accessToken: string | null;
  /** Per-request Supabase client scoped to the user (respects RLS) */
  db: SupabaseClient<Database>;
  /** Admin Supabase client (bypasses RLS — use with caution) */
  adminDb: SupabaseClient<Database>;
  /** Client IP for audit logging */
  ip: string;
  /** Request ID for distributed tracing */
  requestId: string;
}

/**
 * Creates the tRPC context for each incoming request.
 *
 * - Extracts the JWT from the Authorization header
 * - Validates it against Supabase Auth
 * - Returns a scoped DB client that respects RLS
 */
export async function createContext({
  req,
  res,
}: CreateFastifyContextOptions): Promise<Context> {
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  let user: User | null = null;
  let db: SupabaseClient<Database>;

  if (accessToken) {
    // Validate token & extract user via Supabase Auth
    const {
      data: { user: authUser },
      error,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (!error && authUser) {
      user = authUser;
    }
    // Create a user-scoped client (even if token is invalid — RLS will block)
    db = createUserClient(accessToken);
  } else {
    // No token — anon client (RLS will restrict access appropriately)
    db = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? 'unknown';

  const requestId =
    (req.headers['x-request-id'] as string) ?? crypto.randomUUID();

  return {
    req,
    res,
    user,
    accessToken,
    db,
    adminDb: supabaseAdmin,
    ip,
    requestId,
  };
}
