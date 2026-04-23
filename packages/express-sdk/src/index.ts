/**
 * @omnious/express-sdk
 *
 * Drop-in Express middleware that automatically traces every HTTP request
 * and sends traces to Omnious via the `trace.ingest` tRPC endpoint.
 *
 * Usage:
 * ```ts
 * import express from 'express';
 * import { omniousMiddleware } from '@omnious/express-sdk';
 *
 * const app = express();
 * app.use(omniousMiddleware({ apiKey: 'proj_...', apiUrl: 'https://api.omnious.dev' }));
 * ```
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface OmniousMiddlewareOptions {
  /** Omnious project API key (starts with `proj_`) */
  apiKey: string;
  /** Base URL of the Omnious backend, e.g. `https://api.omnious.dev` */
  apiUrl: string;
  /** Optional service name override (default: `express`) */
  serviceName?: string;
  /** Whether to include request body in span attributes (default: false) */
  captureBody?: boolean;
  /** Routes to skip (exact or prefix match), e.g. ['/health', '/metrics'] */
  skipRoutes?: string[];
  /** Maximum batch size before flushing (default: 20) */
  batchSize?: number;
  /** Flush interval in ms (default: 5000) */
  flushInterval?: number;
}

interface SpanPayload {
  span_id: string;
  parent_span_id: string | null;
  operation: string;
  kind: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  status: 'ok' | 'error';
  error_message?: string;
  attributes: Record<string, unknown>;
}

interface TracePayload {
  projectApiKey: string;
  trace: {
    trace_id: string;
    root_service: string;
    root_operation: string;
    http_method: string;
    http_url: string;
    http_status: number;
    started_at: string;
    ended_at: string;
    duration_ms: number;
    status: 'ok' | 'error';
    error_message?: string;
  };
  spans: SpanPayload[];
}

// ─── Internal batch queue ──────────────────────────────────────────────────

class TraceBatcher {
  private queue: TracePayload[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly batchSize: number,
    flushInterval: number,
  ) {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, flushInterval).unref(); // don't keep process alive
  }

  enqueue(payload: TracePayload): void {
    this.queue.push(payload);
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.batchSize);
    for (const payload of batch) {
      try {
        await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ '0': { json: payload } }),
        });
      } catch {
        // Swallow errors — SDK must never affect host app
      }
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// ─── Middleware factory ────────────────────────────────────────────────────

/**
 * Creates an Express middleware that automatically traces HTTP requests.
 * Batches traces and sends them to Omnious in the background.
 */
export function omniousMiddleware(options: OmniousMiddlewareOptions): RequestHandler {
  const {
    apiKey,
    apiUrl,
    serviceName = 'express',
    captureBody = false,
    skipRoutes = ['/health', '/healthz', '/ping', '/metrics', '/favicon.ico'],
    batchSize = 20,
    flushInterval = 5000,
  } = options;

  // Remove trailing slash
  const baseUrl = apiUrl.replace(/\/$/, '');
  // tRPC batch endpoint for trace.ingest (procedure index 0)
  const endpoint = `${baseUrl}/trpc/trace.ingest`;

  const batcher = new TraceBatcher(apiKey, endpoint, batchSize, flushInterval);

  // Graceful shutdown: flush remaining traces on process exit
  process.once('beforeExit', () => {
    void batcher.flush();
    batcher.destroy();
  });

  return function omniousTracingMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Skip health checks and configured routes
    const skip = skipRoutes.some(
      (r) => req.path === r || req.path.startsWith(r + '/'),
    );
    if (skip) {
      next();
      return;
    }

    const traceId = randomUUID();
    const spanId = randomUUID();
    const startTime = performance.now();
    const startedAt = new Date().toISOString();

    // Detect route name from Express router stack
    const operation = req.route?.path ?? req.path ?? 'unknown';

    // Intercept response finish
    res.on('finish', () => {
      const endTime = performance.now();
      const durationMs = Math.round(endTime - startTime);
      const endedAt = new Date().toISOString();
      const isError = res.statusCode >= 500;

      const attributes: Record<string, unknown> = {
        'http.method': req.method,
        'http.url': req.originalUrl,
        'http.status_code': res.statusCode,
        'http.route': operation,
        'express.service': serviceName,
      };

      if (captureBody && req.body && typeof req.body === 'object') {
        attributes['http.request_body'] = JSON.stringify(req.body).slice(0, 1000);
      }

      const payload: TracePayload = {
        projectApiKey: apiKey,
        trace: {
          trace_id: traceId,
          root_service: serviceName,
          root_operation: `${req.method} ${operation}`,
          http_method: req.method,
          http_url: req.originalUrl,
          http_status: res.statusCode,
          started_at: startedAt,
          ended_at: endedAt,
          duration_ms: durationMs,
          status: isError ? 'error' : 'ok',
          ...(isError ? { error_message: `HTTP ${res.statusCode}` } : {}),
        },
        spans: [
          {
            span_id: spanId,
            parent_span_id: null,
            operation: `${req.method} ${operation}`,
            kind: 'server',
            started_at: startedAt,
            ended_at: endedAt,
            duration_ms: durationMs,
            status: isError ? 'error' : 'ok',
            ...(isError ? { error_message: `HTTP ${res.statusCode}` } : {}),
            attributes,
          },
        ],
      };

      batcher.enqueue(payload);
    });

    next();
  };
}

// ─── Re-exports ────────────────────────────────────────────────────────────
export type { TracePayload, SpanPayload };
