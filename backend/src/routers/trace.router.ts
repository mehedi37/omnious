import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, projectProcedure, publicProcedure } from '../trpc/index.js';

const ingestTraceSchema = z.object({
  projectApiKey: z.string(),
  trace: z.object({
    trace_id: z.string(),
    root_service: z.string().optional(),
    root_operation: z.string().optional(),
    http_method: z.string().optional(),
    http_url: z.string().optional(),
    http_status: z.number().int().optional(),
    started_at: z.string().datetime(),
    ended_at: z.string().datetime().optional(),
    duration_ms: z.number().optional(),
    status: z.enum(['ok', 'error', 'timeout', 'partial']).default('ok'),
    error_message: z.string().optional(),
    tags: z.record(z.unknown()).optional(),
  }),
  spans: z.array(
    z.object({
      span_id: z.string(),
      parent_span_id: z.string().nullable().optional(),
      code_node_id: z.string().uuid().nullable().optional(),
      service_name: z.string().optional(),
      operation: z.string(),
      kind: z.string().optional(),
      started_at: z.string().datetime(),
      ended_at: z.string().datetime().optional(),
      duration_ms: z.number().optional(),
      status: z.enum(['ok', 'error', 'timeout', 'partial']).default('ok'),
      error_message: z.string().optional(),
      error_stack: z.string().optional(),
      attributes: z.record(z.unknown()).optional(),
      events: z.array(z.record(z.unknown())).optional(),
    }),
  ),
});

export const traceRouter = router({
  /**
   * Ingest traces via project API key (no user auth — used by OTel SDK).
   * Authenticates using the project-level API key instead.
   */
  ingest: publicProcedure
    .input(ingestTraceSchema)
    .mutation(async ({ ctx, input }) => {
      // Authenticate via project API key
      const { data: project, error: projectError } = await ctx.adminDb
        .from('projects')
        .select('id, trace_quota, workspace_id')
        .eq('api_key', input.projectApiKey)
        .single();

      if (projectError || !project) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid project API key.',
        });
      }

      // Check quota
      const { data: withinQuota } = await ctx.adminDb.rpc(
        'check_trace_quota',
        { p_project_id: project.id },
      );

      if (!withinQuota) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Monthly trace quota exceeded.',
        });
      }

      // Insert trace
      const { data: trace, error: traceError } = await ctx.adminDb
        .from('traces')
        .insert({
          project_id: project.id,
          trace_id: input.trace.trace_id,
          root_service: input.trace.root_service ?? null,
          root_operation: input.trace.root_operation ?? null,
          http_method: input.trace.http_method ?? null,
          http_url: input.trace.http_url ?? null,
          http_status: input.trace.http_status ?? null,
          started_at: input.trace.started_at,
          ended_at: input.trace.ended_at ?? null,
          duration_ms: input.trace.duration_ms ?? null,
          status: input.trace.status,
          error_message: input.trace.error_message ?? null,
          tags: (input.trace.tags ?? {}) as import('../lib/supabase/database.types.js').Json,
        })
        .select('id')
        .single();

      if (traceError || !trace) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: traceError?.message ?? 'Failed to insert trace',
        });
      }

      // Insert spans
      if (input.spans.length > 0) {
        const spanRows = input.spans.map((s) => ({
          project_id: project.id,
          trace_id: trace.id,
          span_id: s.span_id,
          parent_span_id: s.parent_span_id ?? null,
          code_node_id: s.code_node_id ?? null,
          service_name: s.service_name ?? null,
          operation: s.operation,
          kind: s.kind ?? null,
          started_at: s.started_at,
          ended_at: s.ended_at ?? null,
          duration_ms: s.duration_ms ?? null,
          status: s.status,
          error_message: s.error_message ?? null,
          error_stack: s.error_stack ?? null,
          attributes: (s.attributes ?? {}) as import('../lib/supabase/database.types.js').Json,
          events: (s.events ?? []) as unknown as import('../lib/supabase/database.types.js').Json,
        }));

        const { error: spanError } = await ctx.adminDb
          .from('spans')
          .insert(spanRows);

        if (spanError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: spanError.message,
          });
        }

        // ── Extract error snapshots from error spans ────────────────────────
        // For each span with status='error' and code_node_id, upsert an error_snapshot
        // so that the error heatmap / Red Zone feature has data to display.
        const errorSpans = input.spans.filter(
          (s) => s.status === 'error' && s.code_node_id && s.error_message,
        );

        if (errorSpans.length > 0) {
          const errorPromises = errorSpans.map((s) => {
            // Build fingerprint: hash of error_type + code_node_id + first line of message
            const errorType = s.error_message?.split(':')[0]?.trim() ?? 'Error';
            const firstLine = s.error_message?.split('\n')[0] ?? '';
            const fingerprint = `${errorType}::${s.code_node_id}::${firstLine}`.slice(0, 255);

            return ctx.adminDb.rpc('upsert_error_snapshot', {
              p_project_id: project.id,
              p_code_node_id: s.code_node_id!,
              p_trace_id: trace.id,
              p_span_id: s.span_id,
              p_error_type: errorType,
              p_error_message: s.error_message ?? '',
              p_error_stack: s.error_stack ?? '',
              p_fingerprint: fingerprint,
              p_metadata: (s.attributes ?? {}) as import('../lib/supabase/database.types.js').Json,
            });
          });

          // Fire-and-forget — don't block trace ingestion on error snapshot writes
          Promise.allSettled(errorPromises).catch(() => {
            // Silently ignore — error snapshots are best-effort
          });
        }
      }

      return { traceId: trace.id, spanCount: input.spans.length };
    }),

  /** List traces for a project */
  list: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        status: z.enum(['ok', 'error', 'timeout', 'partial']).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from('traces')
        .select('*', { count: 'exact' })
        .eq('project_id', input.projectId)
        .order('started_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (input.status) query = query.eq('status', input.status);

      const { data, error, count } = await query;

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { traces: data, total: count ?? 0 };
    }),

  /** Get a trace with all its spans */
  getById: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        traceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [traceResult, spansResult] = await Promise.all([
        ctx.db
          .from('traces')
          .select('*')
          .eq('id', input.traceId)
          .eq('project_id', input.projectId)
          .single(),
        ctx.db
          .from('spans')
          .select('*')
          .eq('trace_id', input.traceId)
          .order('started_at'),
      ]);

      if (traceResult.error || !traceResult.data) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Trace not found',
        });
      }

      return {
        trace: traceResult.data,
        spans: spansResult.data ?? [],
      };
    }),
});
