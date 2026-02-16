import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, projectProcedure } from '../trpc/index.js';

const listNodesSchema = z.object({
  projectId: z.string().uuid(),
  type: z
    .enum([
      'module', 'component', 'function', 'class', 'route', 'middleware',
      'database_query', 'event_emitter', 'event_listener', 'external_api',
      'variable', 'type_def',
    ])
    .optional(),
  filePath: z.string().optional(),
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

const upsertNodesSchema = z.object({
  projectId: z.string().uuid(),
  nodes: z.array(
    z.object({
      oir_id: z.string(),
      type: z.enum([
        'module', 'component', 'function', 'class', 'route', 'middleware',
        'database_query', 'event_emitter', 'event_listener', 'external_api',
        'variable', 'type_def',
      ]),
      name: z.string(),
      file_path: z.string(),
      line_start: z.number().int().nullable().optional(),
      line_end: z.number().int().nullable().optional(),
      signature: z.string().nullable().optional(),
      doc_comment: z.string().nullable().optional(),
      metadata: z.record(z.unknown()).optional(),
      content_hash: z.string(),
    }),
  ),
});

const upsertEdgesSchema = z.object({
  projectId: z.string().uuid(),
  edges: z.array(
    z.object({
      source_node_id: z.string().uuid(),
      target_node_id: z.string().uuid(),
      type: z.enum([
        'calls', 'imports', 'extends', 'implements', 'renders', 'routes_to',
        'queries', 'emits_event', 'subscribes_to', 'redirects_to', 'uses',
        'exports',
      ]),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
});

const semanticSearchSchema = z.object({
  projectId: z.string().uuid(),
  embedding: z.array(z.number()).length(1536),
  threshold: z.number().min(0).max(1).default(0.78),
  limit: z.number().int().min(1).max(50).default(20),
});

const traverseSchema = z.object({
  projectId: z.string().uuid(),
  nodeId: z.string().uuid(),
  direction: z.enum(['downstream', 'upstream', 'both']).default('downstream'),
  maxDepth: z.number().int().min(1).max(20).default(5),
});

export const graphRouter = router({
  /** List code nodes with optional filters */
  listNodes: projectProcedure
    .input(listNodesSchema)
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from('code_nodes')
        .select('*', { count: 'exact' })
        .eq('project_id', input.projectId)
        .range(input.offset, input.offset + input.limit - 1)
        .order('file_path')
        .order('line_start');

      if (input.type) query = query.eq('type', input.type);
      if (input.filePath) query = query.eq('file_path', input.filePath);
      if (input.search) query = query.ilike('name', `%${input.search}%`);

      const { data, error, count } = await query;

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { nodes: data, total: count ?? 0 };
    }),

  /** Get a single node by ID */
  getNode: projectProcedure
    .input(z.object({ projectId: z.string().uuid(), nodeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('code_nodes')
        .select('*')
        .eq('id', input.nodeId)
        .eq('project_id', input.projectId)
        .single();

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Code node not found' });
      }

      return data;
    }),

  /** List edges for a project */
  listEdges: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        sourceNodeId: z.string().uuid().optional(),
        targetNodeId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(1000).default(500),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.db
        .from('code_edges')
        .select('*', { count: 'exact' })
        .eq('project_id', input.projectId)
        .range(input.offset, input.offset + input.limit - 1);

      if (input.sourceNodeId)
        query = query.eq('source_node_id', input.sourceNodeId);
      if (input.targetNodeId)
        query = query.eq('target_node_id', input.targetNodeId);

      const { data, error, count } = await query;

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { edges: data, total: count ?? 0 };
    }),

  /** Bulk upsert code nodes (used by the parser service) */
  upsertNodes: projectProcedure
    .input(upsertNodesSchema)
    .mutation(async ({ ctx, input }) => {
      const rows = input.nodes.map((n) => ({
        ...n,
        project_id: input.projectId,
        metadata: (n.metadata ?? {}) as import('../lib/supabase/database.types.js').Json,
      }));

      // Use adminDb to bypass RLS for bulk upserts from parser service
      const { data, error } = await ctx.adminDb
        .from('code_nodes')
        .upsert(rows, { onConflict: 'project_id,oir_id' })
        .select('id, oir_id');

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { upserted: data?.length ?? 0, nodes: data };
    }),

  /** Bulk upsert code edges */
  upsertEdges: projectProcedure
    .input(upsertEdgesSchema)
    .mutation(async ({ ctx, input }) => {
      const rows = input.edges.map((e) => ({
        ...e,
        project_id: input.projectId,
        metadata: (e.metadata ?? {}) as import('../lib/supabase/database.types.js').Json,
      }));

      // Use adminDb to bypass RLS for bulk upserts from parser service
      const { data, error } = await ctx.adminDb
        .from('code_edges')
        .upsert(rows, {
          onConflict: 'project_id,source_node_id,target_node_id,type',
        })
        .select('id');

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { upserted: data?.length ?? 0 };
    }),

  /** Semantic search across code nodes using pgvector */
  semanticSearch: projectProcedure
    .input(semanticSearchSchema)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db.rpc('match_code_nodes', {
        query_embedding: JSON.stringify(input.embedding),
        match_project_id: input.projectId,
        match_threshold: input.threshold,
        match_count: input.limit,
      });

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** Traverse the code graph from a starting node */
  traverse: projectProcedure
    .input(traverseSchema)
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db.rpc('traverse_graph', {
        p_node_id: input.nodeId,
        p_direction: input.direction,
        p_max_depth: input.maxDepth,
      });

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),
});
