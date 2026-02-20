import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  router,
  workspaceProcedure,
  projectProcedure,
} from '../trpc/index.js';

const createProjectSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  gitProvider: z.enum(['github', 'gitlab', 'bitbucket', 'local']).optional(),
  gitUrl: z.string().url().optional(),
  gitBranch: z.string().optional(),
  primaryLanguage: z.string().optional(),
  framework: z.string().optional(),
});

const updateProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['active', 'archived', 'importing', 'error']).optional(),
  gitBranch: z.string().optional(),
  primaryLanguage: z.string().optional(),
  framework: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const projectRouter = router({
  /** List projects in a workspace */
  list: workspaceProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        status: z.enum(['active', 'archived', 'importing', 'error']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from('projects')
        .select('*')
        .eq('workspace_id', input.workspaceId)
        .order('updated_at', { ascending: false });

      if (input.status) {
        query = query.eq('status', input.status);
      }

      const { data, error } = await query;

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** Get a single project by ID */
  getById: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('projects')
        .select('*')
        .eq('id', input.projectId)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      return data;
    }),

  /** Get a single project by slug within a workspace */
  getBySlug: workspaceProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        slug: z.string().min(2).max(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('projects')
        .select('*')
        .eq('workspace_id', input.workspaceId)
        .eq('slug', input.slug)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      return data;
    }),

  /** Create a new project */
  create: workspaceProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      // Use adminDb to bypass RLS for project creation
      const { data, error } = await ctx.adminDb
        .from('projects')
        .insert({
          workspace_id: input.workspaceId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          git_provider: input.gitProvider ?? null,
          git_url: input.gitUrl ?? null,
          git_branch: input.gitBranch ?? 'main',
          primary_language: input.primaryLanguage ?? null,
          framework: input.framework ?? null,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A project with this slug already exists.',
          });
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** Update a project */
  update: projectProcedure
    .input(updateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates['name'] = input.name;
      if (input.description !== undefined)
        updates['description'] = input.description;
      if (input.status !== undefined) updates['status'] = input.status;
      if (input.gitBranch !== undefined)
        updates['git_branch'] = input.gitBranch;
      if (input.primaryLanguage !== undefined)
        updates['primary_language'] = input.primaryLanguage;
      if (input.framework !== undefined) updates['framework'] = input.framework;
      if (input.settings !== undefined) updates['settings'] = input.settings;

      const { data, error } = await ctx.db
        .from('projects')
        .update(updates)
        .eq('id', input.projectId)
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

  /** Delete a project */
  delete: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from('projects')
        .delete()
        .eq('id', input.projectId);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { success: true };
    }),

  /** Regenerate a project's API key */
  regenerateApiKey: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Generate new API key server-side
      const newKey = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const { data, error } = await ctx.db
        .from('projects')
        .update({ api_key: newKey })
        .eq('id', input.projectId)
        .select('id, api_key')
        .single();

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** Get project stats (node, edge, trace, error counts) */
  stats: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [nodesResult, edgesResult, tracesResult, errorsResult] =
        await Promise.all([
          ctx.db
            .from('code_nodes')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', input.projectId),
          ctx.db
            .from('code_edges')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', input.projectId),
          ctx.db
            .from('traces')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', input.projectId),
          ctx.db
            .from('error_snapshots')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', input.projectId)
            .eq('resolved', false),
        ]);

      return {
        nodeCount: nodesResult.count ?? 0,
        edgeCount: edgesResult.count ?? 0,
        traceCount: tracesResult.count ?? 0,
        errorCount: errorsResult.count ?? 0,
      };
    }),

  /** Trigger a re-index of the project (sets status to importing, clears last_indexed_at) */
  triggerReindex: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('projects')
        .update({
          status: 'importing',
          last_indexed_at: null,
        })
        .eq('id', input.projectId)
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
