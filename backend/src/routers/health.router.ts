import { router, publicProcedure } from '../trpc/index.js';
import { env } from '../config/env.js';

/** Quickly probe Ollama — returns status without throwing */
async function probeOllama(): Promise<{ status: 'ok' | 'unavailable'; model: string }> {
  try {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch(`${env.OLLAMA_BASE_URL}/models`, { signal: controller.signal });
    clearTimeout(timerId);
    return { status: res.ok ? 'ok' : 'unavailable', model: env.OLLAMA_MODEL };
  } catch {
    return { status: 'unavailable', model: env.OLLAMA_MODEL };
  }
}

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

  /** Ollama connectivity check — useful for frontend AI panel status indicator */
  ollamaStatus: publicProcedure.query(probeOllama),
});
