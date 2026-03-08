import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, projectProcedure } from '../trpc/index.js';

export const errorRouter = router({
  /** List error snapshots for a project */
  list: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        resolved: z.boolean().optional(),
        severity: z.enum(['error', 'warning', 'info']).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from('error_snapshots')
        .select(
          `
          *,
          code_node:code_nodes (id, name, type, file_path)
        `,
          { count: 'exact' },
        )
        .eq('project_id', input.projectId)
        .order('last_seen_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (input.resolved === true) {
        query = query.not('resolved_at', 'is', null);
      } else if (input.resolved === false) {
        query = query.is('resolved_at', null);
      }

      if (input.severity) {
        query = query.eq('severity', input.severity);
      }

      const { data, error, count } = await query;

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { errors: data, total: count ?? 0 };
    }),

  /** Get the error heatmap data ("Red Zone") for a project */
  heatmap: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        since: z.string().default('7 days'),
        severity: z.enum(['error', 'warning', 'info']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (ctx.db.rpc as any)('get_error_heatmap', {
        p_project_id: input.projectId,
        p_since: input.since,
        p_severity_filter: input.severity ?? null,
      });

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** Resolve an error snapshot */
  resolve: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        errorId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('error_snapshots')
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by: ctx.user.id,
        })
        .eq('id', input.errorId)
        .eq('project_id', input.projectId)
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

  /** Unresolve (reopen) an error snapshot */
  unresolve: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        errorId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('error_snapshots')
        .update({ resolved_at: null, resolved_by: null })
        .eq('id', input.errorId)
        .eq('project_id', input.projectId)
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

  /** Get a single error snapshot by ID with linked node + trace info */
  getById: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        errorId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('error_snapshots')
        .select(
          `
          *,
          code_node:code_nodes (id, name, type, file_path, line_start, line_end, signature),
          trace:traces (id, trace_id, http_method, http_url, http_status, started_at, duration_ms, status)
        `,
        )
        .eq('id', input.errorId)
        .eq('project_id', input.projectId)
        .single();

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Error snapshot not found' });
      }

      return data;
    }),

  /** Get daily occurrence history for an error (powered by spans) */
  occurrenceHistory: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        fingerprint: z.string(),
        days: z.number().int().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (ctx.db.rpc as any)('get_error_occurrence_history', {
        p_project_id: input.projectId,
        p_fingerprint: input.fingerprint,
        p_days: input.days,
      });

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      }

      return data ?? [];
    }),

  /** List error snapshots linked to a specific code node */
  listByNode: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        codeNodeId: z.string().uuid(),
        severity: z.enum(['error', 'warning', 'info']).optional(),
        limit: z.number().int().min(1).max(20).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from('error_snapshots')
        .select('id, error_type, error_message, error_stack, occurrence_count, last_seen_at, resolved_at, fingerprint, severity', {
          count: 'exact',
        })
        .eq('project_id', input.projectId)
        .eq('code_node_id', input.codeNodeId)
        .is('resolved_at', null)
        .order('last_seen_at', { ascending: false })
        .limit(input.limit);

      if (input.severity) {
        query = query.eq('severity', input.severity);
      }

      const { data, error, count } = await query;

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      }

      return { errors: data ?? [], total: count ?? 0 };
    }),
});
