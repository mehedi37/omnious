import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, projectProcedure, publicProcedure } from '../trpc/index.js';

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
  limit: z.number().int().min(1).max(2000).default(100),
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

// ── CLI-specific schemas (API-key auth) ──

const OIR_NODE_TYPE = z.enum([
  'module', 'component', 'function', 'class', 'route', 'middleware',
  'database_query', 'event_emitter', 'event_listener', 'external_api',
  'variable', 'type_def',
]);

const OIR_EDGE_TYPE = z.enum([
  'calls', 'imports', 'extends', 'implements', 'renders', 'routes_to',
  'queries', 'emits_event', 'subscribes_to', 'redirects_to', 'uses',
  'exports',
]);

const pushFromCLISchema = z.object({
  projectApiKey: z.string(),
  nodes: z.array(
    z.object({
      oir_id: z.string(),
      type: OIR_NODE_TYPE,
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
  edges: z.array(
    z.object({
      source_oir_id: z.string(),
      target_oir_id: z.string(),
      type: OIR_EDGE_TYPE,
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  git_context: z
    .object({
      commit_hash: z.string().optional(),
      branch: z.string().optional(),
      author_email: z.string().optional(),
      commit_message: z.string().optional(),
    })
    .optional(),
  index_hash: z.string().optional(),
  dry_run: z.boolean().optional(),
});

const getProjectStatusFromCLISchema = z.object({
  projectApiKey: z.string(),
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

  // ── CLI Endpoints (API-key auth, no user session) ──

  /**
   * Push nodes + edges from the CLI.
   * Authenticates via project API key (same pattern as trace.ingest).
   * Accepts oir_id-based edges and resolves them to database UUIDs.
   */
  pushFromCLI: publicProcedure
    .input(pushFromCLISchema)
    .mutation(async ({ ctx, input }) => {
      // Authenticate via project API key
      const { data: project, error: projectError } = await ctx.adminDb
        .from('projects')
        .select('id, name, slug')
        .eq('api_key', input.projectApiKey)
        .single();

      if (projectError || !project) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid project API key.',
        });
      }

      // Dry run — just validate the key and return project info
      if (input.dry_run) {
        return {
          project_id: project.id,
          project_name: project.name,
          nodes_upserted: 0,
          edges_upserted: 0,
          edges_skipped: 0,
        };
      }

      let nodesUpserted = 0;
      let edgesUpserted = 0;
      let edgesSkipped = 0;

      // Step 1: Upsert nodes
      if (input.nodes.length > 0) {
        const nodeRows = input.nodes.map((n) => ({
          project_id: project.id,
          oir_id: n.oir_id,
          type: n.type,
          name: n.name,
          file_path: n.file_path,
          line_start: n.line_start ?? null,
          line_end: n.line_end ?? null,
          signature: n.signature ?? null,
          doc_comment: n.doc_comment ?? null,
          metadata: (n.metadata ?? {}) as import('../lib/supabase/database.types.js').Json,
          content_hash: n.content_hash,
        }));

        const { data: upsertedNodes, error: nodeError } = await ctx.adminDb
          .from('code_nodes')
          .upsert(nodeRows, { onConflict: 'project_id,oir_id' })
          .select('id, oir_id');

        if (nodeError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Node upsert failed: ${nodeError.message}`,
          });
        }

        nodesUpserted = upsertedNodes?.length ?? 0;
      }

      // Step 2: Resolve oir_id → UUID for edges
      if (input.edges.length > 0) {
        // Collect all unique oir_ids referenced by edges
        const oirIds = new Set<string>();
        for (const e of input.edges) {
          oirIds.add(e.source_oir_id);
          oirIds.add(e.target_oir_id);
        }

        // Fetch the oir_id → UUID mapping for this project
        const { data: nodeMapping, error: mapError } = await ctx.adminDb
          .from('code_nodes')
          .select('id, oir_id')
          .eq('project_id', project.id)
          .in('oir_id', [...oirIds]);

        if (mapError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Edge resolution failed: ${mapError.message}`,
          });
        }

        const oirToUuid = new Map<string, string>();
        for (const row of nodeMapping ?? []) {
          oirToUuid.set(row.oir_id, row.id);
        }

        // Build edge rows, skipping edges with unresolved targets
        type EdgeType = import('../lib/supabase/database.types.js').Database['public']['Enums']['oir_edge_type'];
        const edgeRows: Array<{
          project_id: string;
          source_node_id: string;
          target_node_id: string;
          type: EdgeType;
          metadata: import('../lib/supabase/database.types.js').Json;
        }> = [];

        for (const e of input.edges) {
          const sourceId = oirToUuid.get(e.source_oir_id);
          const targetId = oirToUuid.get(e.target_oir_id);
          if (sourceId && targetId) {
            edgeRows.push({
              project_id: project.id,
              source_node_id: sourceId,
              target_node_id: targetId,
              type: e.type as EdgeType,
              metadata: (e.metadata ?? {}) as import('../lib/supabase/database.types.js').Json,
            });
          } else {
            edgesSkipped++;
          }
        }

        if (edgeRows.length > 0) {
          const { data: upsertedEdges, error: edgeError } = await ctx.adminDb
            .from('code_edges')
            .upsert(edgeRows, {
              onConflict: 'project_id,source_node_id,target_node_id,type',
            })
            .select('id');

          if (edgeError) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Edge upsert failed: ${edgeError.message}`,
            });
          }

          edgesUpserted = upsertedEdges?.length ?? 0;
        }
      }

      // Step 3: Update project status, last_indexed_at, and index_hash
      const projectUpdate: Record<string, unknown> = {
        status: 'active',
        last_indexed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (input.index_hash) {
        projectUpdate.last_index_hash = input.index_hash;
      }
      await ctx.adminDb
        .from('projects')
        .update(projectUpdate)
        .eq('id', project.id);

      return {
        project_id: project.id,
        project_name: project.name,
        nodes_upserted: nodesUpserted,
        edges_upserted: edgesUpserted,
        edges_skipped: edgesSkipped,
      };
    }),

  /** Get project status via API key (used by CLI `omnious status --remote`) */
  getProjectStatusFromCLI: publicProcedure
    .input(getProjectStatusFromCLISchema)
    .query(async ({ ctx, input }) => {
      // Authenticate via project API key
      const { data: project, error: projectError } = await ctx.adminDb
        .from('projects')
        .select('id, name, slug, status, last_indexed_at, last_index_hash, updated_at')
        .eq('api_key', input.projectApiKey)
        .single();

      if (projectError || !project) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid project API key.',
        });
      }

      // Count nodes, edges, traces, errors
      const [nodeCount, edgeCount, traceCount, errorCount] = await Promise.all([
        ctx.adminDb
          .from('code_nodes')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .then((r) => r.count ?? 0),
        ctx.adminDb
          .from('code_edges')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .then((r) => r.count ?? 0),
        ctx.adminDb
          .from('traces')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .then((r) => r.count ?? 0),
        ctx.adminDb
          .from('error_snapshots')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .then((r) => r.count ?? 0),
      ]);

      return {
        id: project.id,
        name: project.name,
        slug: project.slug,
        status: project.status ?? 'active',
        last_indexed_at: project.last_indexed_at ?? project.updated_at,
        last_index_hash: project.last_index_hash ?? null,
        node_count: nodeCount,
        edge_count: edgeCount,
        trace_count: traceCount,
        error_count: errorCount,
      };
    }),
});
