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
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db.rpc('get_error_heatmap', {
        p_project_id: input.projectId,
        p_since: input.since,
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
});
