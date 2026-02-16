import { router, publicProcedure } from '../trpc/index.js';

export const healthRouter = router({
  /** Basic health check — no auth required */
  check: publicProcedure.query(() => ({
    status: 'ok' as const,
    timestamp: new Date().toISOString(),
    version: process.env['npm_package_version'] ?? '0.1.0',
  })),

  /** Readiness probe — verifies DB connectivity */
  ready: publicProcedure.query(async ({ ctx }) => {
    const start = Date.now();
    const { error } = await ctx.adminDb
      .from('profiles')
      .select('id')
      .limit(1);

    return {
      status: error ? ('error' as const) : ('ok' as const),
      dbLatencyMs: Date.now() - start,
      error: error?.message,
    };
  }),
});
