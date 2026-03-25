import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, projectProcedure, apiKeyProcedure } from '../trpc/index.js';
import { oirNodeTypeSchema, oirNodeSchema, oirEdgeSchema, oirEdgeByOirIdSchema } from '@omnious/shared/oir-schemas';
import { resolveApiKey, generateModuleGroups, backfillNodeEmbeddings, selectModel, generateProjectPersonality, indexProjectDocuments } from '../services/ai.service.js';
import { generateCodeSummaries, getCodeSummaries } from '../services/summary.service.js';
import { logger } from '../lib/logger.js';

const listNodesSchema = z.object({
  projectId: z.string().uuid(),
  type: oirNodeTypeSchema.optional(),
  filePath: z.string().optional(),
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(2000).default(100),
  offset: z.number().int().min(0).default(0),
});

const upsertNodesSchema = z.object({
  projectId: z.string().uuid(),
  nodes: z.array(oirNodeSchema),
});

const upsertEdgesSchema = z.object({
  projectId: z.string().uuid(),
  edges: z.array(oirEdgeSchema),
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

const pushFromCLISchema = z.object({
  projectApiKey: z.string(),
  nodes: z.array(oirNodeSchema),
  edges: z.array(oirEdgeByOirIdSchema),
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
  /** File paths deleted since last push — their nodes (and cascaded edges) will be removed */
  stale_file_paths: z.array(z.string()).optional(),
  /** Changed file paths — outgoing edges from their nodes are deleted before re-inserting */
  changed_file_paths: z.array(z.string()).optional(),
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
        p_project_id: input.projectId,
        query_embedding: JSON.stringify(input.embedding),
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
  pushFromCLI: apiKeyProcedure
    .input(pushFromCLISchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch workspace slug for the response
      const { data: projectWithWs } = await ctx.adminDb
        .from('projects')
        .select('workspaces(slug)')
        .eq('id', ctx.apiKeyProject.id)
        .single();

      const workspaceSlug = (projectWithWs?.workspaces as unknown as { slug: string } | null)?.slug ?? null;
      const project = { ...ctx.apiKeyProject, workspaces: projectWithWs?.workspaces };

      // Dry run — just validate the key and return project info
      if (input.dry_run) {
        return {
          project_id: project.id,
          project_name: project.name,
          project_slug: project.slug,
          workspace_slug: workspaceSlug,
          nodes_upserted: 0,
          edges_upserted: 0,
          edges_skipped: 0,
        };
      }

      let nodesUpserted = 0;
      let edgesUpserted = 0;
      let edgesSkipped = 0;

      // ── Pre-push cleanup ──

      // 1. Delete nodes from removed files (FK cascade removes their edges automatically)
      const staleFilePaths = input.stale_file_paths ?? [];
      if (staleFilePaths.length > 0) {
        const { error: staleError } = await ctx.adminDb
          .from('code_nodes')
          .delete()
          .eq('project_id', project.id)
          .in('file_path', staleFilePaths);

        if (staleError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Stale node cleanup failed: ${staleError.message}`,
          });
        }
      }

      // 2. Delete outgoing edges from changed files so stale call relationships
      //    are removed before we re-insert the current set.
      const changedFilePaths = input.changed_file_paths ?? [];
      if (changedFilePaths.length > 0) {
        // Resolve node IDs for changed files first
        const { data: changedNodeIds, error: changedNodesError } = await ctx.adminDb
          .from('code_nodes')
          .select('id')
          .eq('project_id', project.id)
          .in('file_path', changedFilePaths);

        if (changedNodesError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Changed node lookup failed: ${changedNodesError.message}`,
          });
        }

        if (changedNodeIds && changedNodeIds.length > 0) {
          const ids = changedNodeIds.map((r) => r.id);
          const { error: edgeCleanupError } = await ctx.adminDb
            .from('code_edges')
            .delete()
            .eq('project_id', project.id)
            .in('source_node_id', ids);

          if (edgeCleanupError) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Edge cleanup for changed files failed: ${edgeCleanupError.message}`,
            });
          }
        }
      }

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
          code_body: n.code_body ?? null,
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

      // Backfill embeddings for new/changed nodes (non-blocking — fire and forget)
      // Collect OIR IDs of pushed nodes so we regenerate their embeddings with graph context
      const pushedOirIds = input.nodes.map((n) => n.oir_id);
      backfillNodeEmbeddings(project.id, ctx.adminDb, {
        changedOirIds: pushedOirIds.length > 0 ? pushedOirIds : undefined,
      }).catch((err) => {
        logger.warn(
          { projectId: project.id, error: err instanceof Error ? err.message : String(err) },
          'Embedding backfill failed (non-fatal)',
        );
      });

      // Generate hierarchical code summaries (non-blocking — fire and forget)
      const summaryKey = { apiKey: 'ollama', provider: 'ollama' as const, source: 'platform' as const };
      const summaryModel = selectModel('overview', '', 'ollama', 'fast');
      generateCodeSummaries(project.id, summaryKey, ctx.adminDb, summaryModel).catch((err) => {
        logger.warn(
          { projectId: project.id, error: err instanceof Error ? err.message : String(err) },
          'Summary generation failed (non-fatal)',
        );
      });

      // Generate project personality (non-blocking — fire and forget)
      generateProjectPersonality(project.id, summaryKey, ctx.adminDb).catch((err) => {
        logger.warn(
          { projectId: project.id, error: err instanceof Error ? err.message : String(err) },
          'Project personality generation failed (non-fatal)',
        );
      });

      return {
        project_id: project.id,
        project_name: project.name,
        project_slug: project.slug,
        workspace_slug: workspaceSlug,
        nodes_upserted: nodesUpserted,
        edges_upserted: edgesUpserted,
        edges_skipped: edgesSkipped,
      };
    }),

  /** Get project status via API key (used by CLI `omnious status --remote`) */
  getProjectStatusFromCLI: apiKeyProcedure
    .input(getProjectStatusFromCLISchema)
    .query(async ({ ctx }) => {
      // Fetch the extra project fields needed for status
      const { data: project, error: projectError } = await ctx.adminDb
        .from('projects')
        .select('id, name, slug, status, last_indexed_at, last_index_hash, updated_at, workspace_id, workspaces(slug)')
        .eq('id', ctx.apiKeyProject.id)
        .single();

      if (projectError || !project) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch project details.',
        });
      }

      // Extract workspace slug from the joined relation
      const workspaceSlug = (project.workspaces as unknown as { slug: string } | null)?.slug ?? null;

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
        workspace_slug: workspaceSlug,
        status: project.status ?? 'active',
        last_indexed_at: project.last_indexed_at ?? project.updated_at,
        last_index_hash: project.last_index_hash ?? null,
        node_count: nodeCount,
        edge_count: edgeCount,
        trace_count: traceCount,
        error_count: errorCount,
      };
    }),

  /**
   * Push static analysis diagnostics from the CLI.
   * Creates error_snapshots for each diagnostic linked to a code node.
   * Authenticated via project API key (same as pushFromCLI).
   */
  pushDiagnostics: apiKeyProcedure
    .input(
      z.object({
        projectApiKey: z.string(),
        diagnostics: z.array(
          z.object({
            code_node_oir_id: z.string().nullable(),
            rule_id: z.string(),
            severity: z.enum(['error', 'warning', 'info']),
            message: z.string(),
            file_path: z.string(),
            line_start: z.number().int().nullable().optional(),
            line_end: z.number().int().nullable().optional(),
            suggestion: z.string().optional(),
            metadata: z.record(z.unknown()).optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = ctx.apiKeyProject;

      // Resolve OIR IDs → code_node UUIDs (filter out null OIR IDs from failed rules)
      const oirIds = [
        ...new Set(
          input.diagnostics
            .filter((d) => d.code_node_oir_id !== null)
            .map((d) => d.code_node_oir_id as string)
        ),
      ];
      const { data: nodes } = await ctx.adminDb
        .from('code_nodes')
        .select('id, oir_id')
        .eq('project_id', project.id)
        .in('oir_id', oirIds.length > 0 ? oirIds : ['']);

      const oirToUuid = new Map<string, string>();
      for (const n of nodes ?? []) {
        oirToUuid.set(n.oir_id, n.id);
      }

      // Upsert error snapshots for each diagnostic (skip those with null code_node_oir_id)
      let created = 0;
      let skipped = 0;
      const upsertPromises = input.diagnostics.map(async (d) => {
        // Skip diagnostics from failed rules that have null OIR ID
        if (d.code_node_oir_id === null) {
          skipped++;
          return;
        }
        const codeNodeId = oirToUuid.get(d.code_node_oir_id);
        if (!codeNodeId) {
          skipped++;
          return;
        }

        const fingerprint = `static::${d.rule_id}::${codeNodeId}::${d.file_path}:${d.line_start ?? 0}`;

        const { error } = await ctx.adminDb.rpc('upsert_error_snapshot', {
          p_project_id: project.id,
          p_code_node_id: codeNodeId,
          p_trace_id: null as unknown as string, // static analysis — no trace
          p_span_id: null as unknown as string,
          p_error_type: `static/${d.rule_id}`,
          p_error_message: d.message,
          p_error_stack: d.suggestion ?? '',
          p_fingerprint: fingerprint.slice(0, 255),
          p_metadata: {
            rule_id: d.rule_id,
            file_path: d.file_path,
            line_start: d.line_start,
            line_end: d.line_end,
            ...(d.metadata ?? {}),
          } as import('../lib/supabase/database.types.js').Json,
          p_span_otel_id: null as unknown as string,
          p_source: 'cli-static-analysis',
          p_severity: d.severity,
        });

        if (!error) created++;
        else skipped++;
      });

      await Promise.allSettled(upsertPromises);

      return { upserted: created, skipped, total: input.diagnostics.length };
    }),

  /** Get AI-generated semantic module groups for a project's code nodes */
  getModuleGroups: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Fetch all code nodes (compact projection)
      const { data: nodes, error } = await ctx.db
        .from('code_nodes')
        .select('id, name, type, file_path')
        .eq('project_id', input.projectId)
        .order('file_path')
        .limit(500);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      if (!nodes || nodes.length === 0) {
        return { groups: [] };
      }

      let resolvedKey;
      try {
        resolvedKey = await resolveApiKey(ctx.user.id, ctx.db, {
          projectId: input.projectId,
        });
      } catch {
        // No API key — return empty groups instead of failing
        logger.info({ projectId: input.projectId }, 'No API key for module grouping');
        return { groups: [] };
      }

      const groups = await generateModuleGroups(nodes, resolvedKey, ctx.adminDb);
      return { groups };
    }),

  /** Fetch hierarchical code summaries for the tree sidebar */
  getSummaries: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const summaries = await getCodeSummaries(input.projectId, ctx.db);
      return { summaries };
    }),

  /** Lightweight full-project tree — all code nodes (id, name, type, file_path, line_start only).
   *  Used by the AST sidebar to show the complete project structure, not just the active subgraph. */
  getProjectTree: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('code_nodes')
        .select('id, oir_id, type, name, file_path, line_start')
        .eq('project_id', input.projectId)
        .order('file_path')
        .order('line_start')
        .limit(5000);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { nodes: data ?? [] };
    }),

  /** Detect communities using algorithmic label propagation (LLM-free) */
  detectCommunities: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.adminDb.rpc('detect_communities', {
        p_project_id: input.projectId,
        p_max_iterations: 10,
      });

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Community detection failed: ${error.message}`,
        });
      }

      // Group by community label and assign colors
      const COMMUNITY_COLORS = [
        '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
        '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
        '#84cc16', '#e11d48',
      ];

      const communityMap = new Map<string, Array<{ id: string; name: string; type: string; file_path: string }>>();
      for (const row of data ?? []) {
        const communityId = row.community;
        const arr = communityMap.get(communityId) ?? [];
        arr.push({
          id: row.node_id,
          name: row.node_name,
          type: row.node_type,
          file_path: row.file_path,
        });
        communityMap.set(communityId, arr);
      }

      // Convert to labeled groups, sorted by size descending
      const communities = [...communityMap.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 20) // Cap at 20 communities
        .map(([_id, members], idx) => {
          // Derive community name from most common directory prefix
          const dirs = members.map((m) => {
            const parts = m.file_path.split('/');
            return parts.length > 1 ? parts.slice(0, -1).join('/') : '/';
          });
          const dirCounts = new Map<string, number>();
          for (const d of dirs) dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
          const topDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'misc';

          return {
            label: topDir,
            color: COMMUNITY_COLORS[idx % COMMUNITY_COLORS.length],
            nodeIds: members.map((m) => m.id),
            nodeCount: members.length,
          };
        });

      return { communities };
    }),

  /** Report a runtime error from the CLI (parses stack frames and maps to code nodes) */
  reportErrorFromCLI: apiKeyProcedure
    .input(
      z.object({
        projectApiKey: z.string().min(1),
        error_type: z.string().min(1).max(255),
        error_message: z.string().min(1).max(2000),
        error_stack: z.string().max(8000).default(''),
        severity: z.enum(['error', 'warning', 'info']).default('error'),
        frames: z.array(
          z.object({
            file_path: z.string(),
            function_name: z.string().nullable(),
            line: z.number().nullable(),
            column: z.number().nullable(),
          }),
        ).max(50).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = ctx.apiKeyProject;

      // Try to resolve stack frames to code nodes
      let matchedNodeId: string | null = null;
      let framesMatched = 0;

      if (input.frames.length > 0) {
        // Get all code nodes for this project to match against
        const framePaths = input.frames
          .map((f) => f.file_path)
          .filter(Boolean);

        if (framePaths.length > 0) {
          // Normalize: keep only relative portions of paths
          const relPaths = framePaths.map((fp) => {
            // Strip common prefixes like /home/user/project/ or /app/
            const parts = fp.split('/');
            // Find the portion after common root patterns
            const srcIdx = parts.findIndex((p) => ['src', 'lib', 'app', 'pages', 'api', 'components'].includes(p));
            return srcIdx >= 0 ? parts.slice(srcIdx).join('/') : parts.slice(-3).join('/');
          });

          // Try matching frames against code_nodes by file_path + function_name
          for (let i = 0; i < input.frames.length && !matchedNodeId; i++) {
            const frame = input.frames[i];
            const relPath = relPaths[i];

            // Try matching by file path suffix + function name
            if (frame.function_name) {
              const { data: matches } = await ctx.adminDb
                .from('code_nodes')
                .select('id')
                .eq('project_id', project.id)
                .ilike('file_path', `%${relPath}`)
                .eq('name', frame.function_name)
                .limit(1);

              if (matches && matches.length > 0) {
                matchedNodeId = matches[0].id;
                framesMatched++;
                continue;
              }
            }

            // Fallback: match by file path + line range
            if (frame.line) {
              const { data: matches } = await ctx.adminDb
                .from('code_nodes')
                .select('id')
                .eq('project_id', project.id)
                .ilike('file_path', `%${relPath}`)
                .lte('line_start', frame.line)
                .gte('line_end', frame.line)
                .limit(1);

              if (matches && matches.length > 0) {
                matchedNodeId = matches[0].id;
                framesMatched++;
              }
            }
          }
        }
      }

      // Generate fingerprint for deduplication
      const fingerprint = `runtime::${input.error_type}::${matchedNodeId ?? 'unknown'}::${input.error_message.slice(0, 100)}`;

      // Upsert error snapshot
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: snapshotId, error } = await (ctx.adminDb.rpc as any)('upsert_error_snapshot', {
        p_project_id: project.id,
        p_code_node_id: matchedNodeId,
        p_trace_id: null as unknown as string,
        p_span_id: null as unknown as string,
        p_error_type: input.error_type,
        p_error_message: input.error_message,
        p_error_stack: input.error_stack,
        p_fingerprint: fingerprint.slice(0, 255),
        p_metadata: {
          source: 'cli-report-error',
          frames: input.frames.slice(0, 10),
          frames_matched: framesMatched,
        } as import('../lib/supabase/database.types.js').Json,
        p_span_otel_id: null as unknown as string,
        p_source: 'cli-report-error',
        p_severity: input.severity,
      });

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Error snapshot creation failed: ${error.message}`,
        });
      }

      return {
        snapshot_id: snapshotId as string | null,
        matched_node_id: matchedNodeId,
        frames_matched: framesMatched,
      };
    }),

  /** Push project documents for RAG indexing (called from CLI after push) */
  pushDocuments: apiKeyProcedure
    .input(
      z.object({
        projectApiKey: z.string().min(1),
        documents: z.array(
          z.object({
            path: z.string().min(1),
            content: z.string().min(1),
            doc_type: z.string().default('markdown'),
          }),
        ).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await indexProjectDocuments(
        ctx.apiKeyProject.id,
        input.documents.map((d) => ({
          path: d.path,
          content: d.content,
          docType: d.doc_type,
        })),
        ctx.adminDb,
      );
      return result;
    }),
});
