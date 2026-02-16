import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/index.js';

export const authRouter = router({
  /** Get the currently authenticated user's profile */
  me: protectedProcedure.query(async ({ ctx }) => {
    const { data: profile, error } = await ctx.db
      .from('profiles')
      .select('*')
      .eq('id', ctx.user.id)
      .single();

    if (error || !profile) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Profile not found',
      });
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
});
