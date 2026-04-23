/**
 * @omnious/nextjs-sdk
 *
 * Next.js integration for Omnious error reporting and request tracing.
 *
 * ## Setup
 *
 * ### 1. Wrap your Next.js config (next.config.ts):
 * ```ts
 * import { withOmnious } from '@omnious/nextjs-sdk';
 * export default withOmnious({ apiKey: 'proj_...', apiUrl: 'https://api.omnious.dev' })(nextConfig);
 * ```
 *
 * ### 2. Report errors from error boundaries (app/global-error.tsx):
 * ```tsx
 * 'use client';
 * import { reportError } from '@omnious/nextjs-sdk';
 * export default function GlobalError({ error }: { error: Error }) {
 *   useEffect(() => { reportError(error); }, [error]);
 *   return <html><body><h2>Something went wrong</h2></body></html>;
 * }
 * ```
 *
 * ### 3. Optional: add instrumentation.ts for server-side tracing:
 * ```ts
 * export async function register() {
 *   if (process.env.NEXT_RUNTIME === 'nodejs') {
 *     const { setupOmniousInstrumentation } = await import('@omnious/nextjs-sdk');
 *     setupOmniousInstrumentation({ apiKey: process.env.OMNIOUS_API_KEY!, apiUrl: process.env.OMNIOUS_API_URL! });
 *   }
 * }
 * ```
 */

import { randomUUID } from 'node:crypto';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface OmniousNextOptions {
  /** Omnious project API key (starts with `proj_`) */
  apiKey: string;
  /** Base URL of the Omnious backend, e.g. `https://api.omnious.dev` */
  apiUrl: string;
  /** Optional service name (default: 'nextjs') */
  serviceName?: string;
}

// ─── Global config singleton ───────────────────────────────────────────────

let _config: OmniousNextOptions | null = null;

function getConfig(): OmniousNextOptions {
  if (!_config) {
    throw new Error(
      '[Omnious] Not configured. Call configure() or withOmnious() before using SDK methods.',
    );
  }
  return _config;
}

/**
 * Configure the SDK. Call once at app startup.
 */
export function configure(options: OmniousNextOptions): void {
  _config = options;
}

// ─── next.config wrapper ───────────────────────────────────────────────────

/**
 * Wraps a Next.js config object to inject Omnious environment variables.
 *
 * Usage in next.config.ts:
 * ```ts
 * import { withOmnious } from '@omnious/nextjs-sdk';
 * export default withOmnious({ apiKey: 'proj_...', apiUrl: '...' })(nextConfig);
 * ```
 */
export function withOmnious(
  options: OmniousNextOptions,
): (nextConfig: Record<string, unknown>) => Record<string, unknown> {
  configure(options);
  return function wrapNextConfig(nextConfig: Record<string, unknown>): Record<string, unknown> {
    return {
      ...nextConfig,
      env: {
        ...(nextConfig.env as Record<string, string> | undefined),
        OMNIOUS_API_KEY: options.apiKey,
        OMNIOUS_API_URL: options.apiUrl,
      },
    };
  };
}

// ─── Error reporting ───────────────────────────────────────────────────────

/**
 * Report a caught error to Omnious.
 * Safe to call from error boundaries, global-error.tsx, and server actions.
 *
 * @param error  The error to report
 * @param context  Optional extra context (route, user, etc.)
 */
export async function reportError(
  error: Error | unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    const cfg = _config ?? {
      apiKey: (typeof process !== 'undefined' && process.env.OMNIOUS_API_KEY) ?? '',
      apiUrl: (typeof process !== 'undefined' && process.env.OMNIOUS_API_URL) ?? '',
    };

    if (!cfg.apiKey || !cfg.apiUrl) return; // silent no-op if unconfigured

    const err = error instanceof Error ? error : new Error(String(error));
    const traceId = randomUUID();
    const now = new Date().toISOString();
    const serviceName = cfg.serviceName ?? 'nextjs';

    const payload = {
      projectApiKey: cfg.apiKey,
      trace: {
        trace_id: traceId,
        root_service: serviceName,
        root_operation: 'error_boundary',
        started_at: now,
        ended_at: now,
        duration_ms: 0,
        status: 'error',
        error_message: err.message,
      },
      spans: [
        {
          span_id: randomUUID(),
          parent_span_id: null,
          operation: err.name ?? 'Error',
          kind: 'internal',
          started_at: now,
          ended_at: now,
          duration_ms: 0,
          status: 'error',
          error_message: err.message,
          error_stack: err.stack ?? undefined,
          attributes: {
            'error.type': err.name,
            'error.message': err.message,
            'nextjs.service': serviceName,
            ...context,
          },
        },
      ],
    };

    const endpoint = `${cfg.apiUrl.replace(/\/$/, '')}/trpc/trace.ingest`;
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ '0': { json: payload } }),
    });
  } catch {
    // SDK must never throw in error handlers
  }
}

// ─── Server-side instrumentation ──────────────────────────────────────────

let _fetchPatched = false;

/**
 * Set up server-side instrumentation.
 * Call from `instrumentation.ts` register() when NEXT_RUNTIME === 'nodejs'.
 */
export function setupOmniousInstrumentation(options: OmniousNextOptions): void {
  configure(options);

  // Patch global fetch to add trace headers for outgoing requests
  if (_fetchPatched || typeof globalThis.fetch === 'undefined') return;
  _fetchPatched = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const traceId = randomUUID();
    const headers = new Headers(init?.headers);
    headers.set('x-omnious-trace-id', traceId);

    return originalFetch(input, { ...init, headers });
  };
}

// ─── Re-exports ────────────────────────────────────────────────────────────
export type { OmniousNextOptions };
