import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc/index.js';
import { supabaseAdmin } from '../lib/supabase/client.js';

// ── Device Flow helpers ──

/** Generate a random hex string */
function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate a short user-friendly code like "ABCD-1234" */
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  let code = '';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += '-';
  }
  return code;
}

export const authRouter = router({
  /** Get the currently authenticated user's profile */
  me: protectedProcedure.query(async ({ ctx }) => {
    const { data: profile, error } = await ctx.db
      .from('profiles')
      .select('*')
      .eq('id', ctx.user.id)
      .single();

    if (error || !profile) {
      // Profile missing — this can happen if the on_auth_user_created trigger
      // didn't fire (e.g. users who signed up before the trigger was added).
      // Auto-create the profile from auth metadata as a recovery path.
      const meta = ctx.user.user_metadata ?? {};
      const displayName =
        (meta['full_name'] as string | undefined) ??
        (meta['name'] as string | undefined) ??
        ctx.user.email ??
        'Unknown';
      const avatarUrl =
        (meta['avatar_url'] as string | undefined) ??
        (meta['picture'] as string | undefined) ??
        null;

      // Use adminDb (service role) to bypass RLS — the INSERT policy may not
      // exist for older deployments, and this is a trusted server-side recovery.
      const { data: created, error: createError } = await ctx.adminDb
        .from('profiles')
        .insert({ id: ctx.user.id, display_name: displayName, avatar_url: avatarUrl })
        .select()
        .single();

      if (createError || !created) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Profile not found and could not be created: ${createError?.message ?? 'unknown'}`,
        });
      }

      return created;
    }

    return profile;
  }),

  /** Update the current user's profile */
  updateProfile: protectedProcedure
    .input(
      z.object({
        displayName: z.string().min(1).max(100).optional(),
        avatarUrl: z.string().url().optional(),
        onboardingCompleted: z.boolean().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = {};
      if (input.displayName !== undefined)
        updates['display_name'] = input.displayName;
      if (input.avatarUrl !== undefined)
        updates['avatar_url'] = input.avatarUrl;
      if (input.onboardingCompleted !== undefined)
        updates['onboarding_completed'] = input.onboardingCompleted;
      if (input.metadata !== undefined) updates['metadata'] = input.metadata;

      const { data, error } = await ctx.db
        .from('profiles')
        .update(updates)
        .eq('id', ctx.user.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  // ── Device Flow OAuth (for CLI authentication) ──

  /**
   * Step 1: CLI requests a device code.
   * Returns device_code (internal), user_code (shown to user), and verification_uri.
   */
  deviceCodeRequest: publicProcedure.mutation(async () => {
    const deviceCode = randomHex(32);
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString(); // 10 minutes

    const { error } = await supabaseAdmin.from('device_codes').insert({
      device_code: deviceCode,
      user_code: userCode,
      status: 'pending',
      expires_at: expiresAt,
      poll_interval: 5,
    });

    if (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to create device code: ${error.message}`,
      });
    }

    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${process.env['FRONTEND_URL'] ?? 'http://localhost:3000'}/device`,
      expires_in: 600,
      interval: 5,
    };
  }),

  /**
   * Step 2: CLI polls this endpoint until user authorizes or code expires.
   * Returns the same error codes as RFC 8628.
   */
  devicePoll: publicProcedure
    .input(z.object({ deviceCode: z.string() }))
    .query(async ({ input }) => {
      const { data: entry, error } = await supabaseAdmin
        .from('device_codes')
        .select('*')
        .eq('device_code', input.deviceCode)
        .single();

      if (error || !entry) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'expired_token',
        });
      }

      if (new Date(entry.expires_at) < new Date()) {
        // Clean up expired entry
        await supabaseAdmin
          .from('device_codes')
          .delete()
          .eq('device_code', input.deviceCode);
        throw new TRPCError({
          code: 'TIMEOUT',
          message: 'expired_token',
        });
      }

      if (entry.status === 'pending') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'authorization_pending',
        });
      }

      if (entry.status === 'authorized') {
        // Consume the code (one-time use)
        await supabaseAdmin
          .from('device_codes')
          .delete()
          .eq('device_code', input.deviceCode);
        return {
          access_token: entry.access_token!,
          refresh_token: entry.refresh_token!,
          user_email: entry.user_email!,
        };
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unknown device code status',
      });
    }),

  /**
   * Step 3: The user (in the browser, authenticated) authorizes a device code.
   * The frontend calls this endpoint with the user_code to complete the flow.
   */
  deviceAuthorize: protectedProcedure
    .input(z.object({ userCode: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Find the pending device code entry by user code
      const { data: entry, error: fetchError } = await supabaseAdmin
        .from('device_codes')
        .select('*')
        .eq('user_code', input.userCode)
        .eq('status', 'pending')
        .single();

      if (fetchError || !entry) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invalid or expired user code.',
        });
      }

      if (new Date(entry.expires_at) < new Date()) {
        await supabaseAdmin
          .from('device_codes')
          .delete()
          .eq('device_code', entry.device_code);
        throw new TRPCError({
          code: 'TIMEOUT',
          message: 'User code has expired.',
        });
      }

      // Get the user's email
      const userEmail = ctx.user.email ?? 'unknown';

      if (!ctx.accessToken) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'No access token available.',
        });
      }

      // Mark as authorized with the user's tokens
      const { error: updateError } = await supabaseAdmin
        .from('device_codes')
        .update({
          status: 'authorized',
          access_token: ctx.accessToken,
          refresh_token: '',
          user_email: userEmail,
        })
        .eq('device_code', entry.device_code);

      if (updateError) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to authorize device: ${updateError.message}`,
        });
      }

      return { success: true, user_email: userEmail };
    }),
});
