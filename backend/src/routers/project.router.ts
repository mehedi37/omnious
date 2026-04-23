import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Database } from '../lib/supabase/database.types.js';
import {
  router,
  workspaceProcedure,
  projectProcedure,
} from '../trpc/index.js';
import { memPalaceService } from '../services/mempalace.service.js';

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

      // Fire-and-forget: initialise MemPalace wing for this project
      memPalaceService.initProject(data.id as string, data.slug as string).catch(() => null);

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

  /** Get sync status for a project (used by frontend SyncStatusBadge) */
  getSyncStatus: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: project, error: projectError } = await ctx.db
        .from('projects')
        .select('id, status, last_indexed_at, last_index_hash')
        .eq('id', input.projectId)
        .single();

      if (projectError || !project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found.',
        });
      }

      const [nodesResult, edgesResult] = await Promise.all([
        ctx.db
          .from('code_nodes')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', input.projectId),
        ctx.db
          .from('code_edges')
          .select('*', { count: 'exact', head: true })
          .eq('project_id', input.projectId),
      ]);

      // Derive sync_state from project data
      type SyncState = 'empty' | 'synced' | 'importing' | 'error' | 'stale' | 'unknown';
      let syncState: SyncState = 'unknown';
      const nodeCount = nodesResult.count ?? 0;

      if (project.status === 'importing') {
        syncState = 'importing';
      } else if (project.status === 'error') {
        syncState = 'error';
      } else if (nodeCount === 0 && !project.last_indexed_at) {
        syncState = 'empty';
      } else if (project.last_index_hash && project.last_indexed_at) {
        // Check staleness: if last_indexed_at is older than 7 days, mark as stale
        const lastIndexed = new Date(project.last_indexed_at);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        syncState = lastIndexed < sevenDaysAgo ? 'stale' : 'synced';
      } else if (nodeCount > 0) {
        syncState = 'synced';
      }

      return {
        status: project.status ?? 'active',
        last_indexed_at: project.last_indexed_at,
        last_index_hash: project.last_index_hash,
        node_count: nodeCount,
        edge_count: edgesResult.count ?? 0,
        sync_state: syncState,
      };
    }),

  /** Set the selected API key for a project */
  setSelectedKey: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        keyId: z.string().uuid().nullable(), // null = use account default
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Validate that the key belongs to this user
      if (input.keyId) {
        const { data: keyData } = await ctx.db
          .from('user_api_keys')
          .select('id')
          .eq('id', input.keyId)
          .eq('user_id', ctx.user.id)
          .single();

        if (!keyData) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'API key not found or does not belong to you',
          });
        }
      }

      // Update the project's selected_key_id
      const { data, error } = await ctx.db
        .from('projects')
        .update({ selected_key_id: input.keyId })
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

  /** Comprehensive project overview for the web dashboard (mirrors CLI `omnious status --remote`) */
  getProjectOverview: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const pid = input.projectId;

      // Fetch project details
      const { data: project, error: projectError } = await ctx.db
        .from('projects')
        .select('id, name, slug, status, last_indexed_at, last_index_hash, settings')
        .eq('id', pid)
        .single();

      if (projectError || !project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
      }

      // Parallel count queries
      const [
        nodeCount,
        edgeCount,
        traceCount,
        errorCount,
        summaryCount,
        clusterCount,
        nodeTypeBreakdown,
      ] = await Promise.all([
        ctx.db.from('code_nodes').select('*', { count: 'exact', head: true }).eq('project_id', pid).then((r) => r.count ?? 0),
        ctx.db.from('code_edges').select('*', { count: 'exact', head: true }).eq('project_id', pid).then((r) => r.count ?? 0),
        ctx.db.from('traces').select('*', { count: 'exact', head: true }).eq('project_id', pid).then((r) => r.count ?? 0),
        ctx.db.from('error_snapshots').select('*', { count: 'exact', head: true }).eq('project_id', pid).eq('resolved', false).then((r) => r.count ?? 0),
        ctx.db.from('code_summaries').select('*', { count: 'exact', head: true }).eq('project_id', pid).then((r) => r.count ?? 0),
        ctx.db.from('code_node_clusters').select('*', { count: 'exact', head: true }).eq('project_id', pid).then((r) => r.count ?? 0),
        ctx.db.from('code_nodes').select('type').eq('project_id', pid).then((r) => {
          const counts: Record<string, number> = {};
          for (const row of r.data ?? []) {
            counts[row.type] = (counts[row.type] || 0) + 1;
          }
          return counts;
        }),
      ]);

      // Derive sync state
      type SyncState = 'empty' | 'synced' | 'importing' | 'error' | 'stale' | 'unknown';
      let syncState: SyncState = 'unknown';
      if (project.status === 'importing') {
        syncState = 'importing';
      } else if (project.status === 'error') {
        syncState = 'error';
      } else if (nodeCount === 0 && !project.last_indexed_at) {
        syncState = 'empty';
      } else if (project.last_index_hash && project.last_indexed_at) {
        const lastIndexed = new Date(project.last_indexed_at);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        syncState = lastIndexed < sevenDaysAgo ? 'stale' : 'synced';
      } else if (nodeCount > 0) {
        syncState = 'synced';
      }

      // Check if AI profile exists
      const settings = project.settings as Record<string, unknown> | null;
      const hasAiProfile = !!(settings?.ai_profile);
      const insightsFeed = (settings?.insights_feed ?? []) as Array<{
        level: 'error' | 'warning' | 'info';
        title: string;
        detail: string;
        timestamp: string;
      }>;

      return {
        name: project.name,
        slug: project.slug,
        status: project.status ?? 'active',
        last_indexed_at: project.last_indexed_at,
        last_index_hash: project.last_index_hash,
        sync_state: syncState,
        has_ai_profile: hasAiProfile,
        insights_feed: insightsFeed,
        counts: {
          nodes: nodeCount,
          edges: edgeCount,
          traces: traceCount,
          errors: errorCount,
          summaries: summaryCount,
          clusters: clusterCount,
        },
        node_type_breakdown: nodeTypeBreakdown,
      };
    }),

  /**
   * Seed a project with synthetic demo data so users can explore Omnious
   * without having to push their own codebase first.
   */
  seedDemoData: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Idempotency: skip if project already has nodes
      const { count: existingNodeCount } = await ctx.db
        .from('code_nodes')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', input.projectId);

      if ((existingNodeCount ?? 0) > 0) {
        return { seeded: false, message: 'Project already has data — skipping seed.' };
      }

      // ── Demo nodes: a small e-commerce API ──────────────────────────────
      type NodeInsert = {
        project_id: string;
        oir_id: string;
        type: string;
        name: string;
        file_path: string;
        line_start: number;
        line_end: number;
        signature: string | null;
        doc_comment: string | null;
        metadata: Record<string, unknown>;
      };

      const nodeSeeds: Omit<NodeInsert, 'project_id'>[] = [
        // Auth module
        { oir_id: 'demo::auth::validateToken', type: 'function', name: 'validateToken', file_path: 'src/auth/middleware.ts', line_start: 12, line_end: 42, signature: 'validateToken(req: Request): Promise<User>', doc_comment: 'Validates JWT access token from Authorization header. Throws 401 on invalid or expired tokens.', metadata: {} },
        { oir_id: 'demo::auth::createSession', type: 'function', name: 'createSession', file_path: 'src/auth/session.ts', line_start: 5, line_end: 28, signature: 'createSession(userId: string): Promise<Session>', doc_comment: null, metadata: {} },
        { oir_id: 'demo::auth::hashPassword', type: 'function', name: 'hashPassword', file_path: 'src/auth/crypto.ts', line_start: 3, line_end: 12, signature: 'hashPassword(plain: string): string', doc_comment: 'Uses bcrypt with cost factor 12.', metadata: {} },
        // Order module
        { oir_id: 'demo::orders::createOrder', type: 'function', name: 'createOrder', file_path: 'src/orders/service.ts', line_start: 45, line_end: 98, signature: 'createOrder(userId: string, items: CartItem[]): Promise<Order>', doc_comment: 'Creates a new order, deducts inventory, and queues payment.', metadata: {} },
        { oir_id: 'demo::orders::processPayment', type: 'function', name: 'processPayment', file_path: 'src/orders/payment.ts', line_start: 10, line_end: 65, signature: 'processPayment(orderId: string, paymentMethod: PaymentMethod): Promise<PaymentResult>', doc_comment: null, metadata: {} },
        { oir_id: 'demo::orders::sendConfirmation', type: 'function', name: 'sendConfirmation', file_path: 'src/orders/notifications.ts', line_start: 3, line_end: 22, signature: 'sendConfirmation(order: Order): Promise<void>', doc_comment: null, metadata: {} },
        { oir_id: 'demo::orders::updateInventory', type: 'function', name: 'updateInventory', file_path: 'src/orders/inventory.ts', line_start: 15, line_end: 44, signature: 'updateInventory(items: CartItem[]): Promise<void>', doc_comment: null, metadata: {} },
        // Product module
        { oir_id: 'demo::products::getProduct', type: 'function', name: 'getProduct', file_path: 'src/products/service.ts', line_start: 8, line_end: 30, signature: 'getProduct(id: string): Promise<Product | null>', doc_comment: null, metadata: {} },
        { oir_id: 'demo::products::searchProducts', type: 'function', name: 'searchProducts', file_path: 'src/products/search.ts', line_start: 20, line_end: 75, signature: 'searchProducts(query: string, filters: SearchFilters): Promise<Product[]>', doc_comment: 'Full-text search with price + category filters.', metadata: {} },
        { oir_id: 'demo::products::getCachedProduct', type: 'function', name: 'getCachedProduct', file_path: 'src/products/cache.ts', line_start: 5, line_end: 25, signature: 'getCachedProduct(id: string): Product | undefined', doc_comment: null, metadata: {} },
        // User module
        { oir_id: 'demo::users::getUser', type: 'function', name: 'getUser', file_path: 'src/users/service.ts', line_start: 10, line_end: 28, signature: 'getUser(id: string): Promise<User | null>', doc_comment: null, metadata: {} },
        { oir_id: 'demo::users::updateProfile', type: 'function', name: 'updateProfile', file_path: 'src/users/service.ts', line_start: 30, line_end: 55, signature: 'updateProfile(userId: string, updates: Partial<User>): Promise<User>', doc_comment: null, metadata: {} },
        // API routes
        { oir_id: 'demo::routes::POST_orders', type: 'route_handler', name: 'POST /api/orders', file_path: 'src/routes/orders.ts', line_start: 15, line_end: 45, signature: 'POST /api/orders', doc_comment: 'Creates a new order. Requires auth.', metadata: {} },
        { oir_id: 'demo::routes::GET_products', type: 'route_handler', name: 'GET /api/products', file_path: 'src/routes/products.ts', line_start: 10, line_end: 35, signature: 'GET /api/products?q=&page=', doc_comment: null, metadata: {} },
        { oir_id: 'demo::routes::POST_auth_login', type: 'route_handler', name: 'POST /api/auth/login', file_path: 'src/routes/auth.ts', line_start: 5, line_end: 40, signature: 'POST /api/auth/login', doc_comment: null, metadata: {} },
      ];

      const nodeRows = nodeSeeds.map((n) => ({ ...n, project_id: input.projectId, content_hash: '' }));
      const { data: insertedNodes, error: nodesError } = await ctx.db
        .from('code_nodes')
        .insert(nodeRows as unknown as Database['public']['Tables']['code_nodes']['Insert'][])
        .select('id, oir_id');

      if (nodesError || !insertedNodes) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: nodesError?.message ?? 'Node seed failed' });
      }

      // Build oir_id → uuid map
      const oirToId = new Map(insertedNodes.map((n) => [n.oir_id, n.id]));

      // ── Demo edges ─────────────────────────────────────────────────────
      type EdgeInsert = { project_id: string; source_node_id: string; target_node_id: string; type: 'calls' | 'imports' | 'extends' | 'implements' | 'renders' | 'routes_to' | 'queries' | 'emits_event' | 'subscribes_to' | 'redirects_to' | 'uses' | 'exports' };
      const edgeSeeds: [string, string][] = [
        ['demo::routes::POST_auth_login', 'demo::auth::validateToken'],
        ['demo::routes::POST_auth_login', 'demo::auth::hashPassword'],
        ['demo::routes::POST_auth_login', 'demo::auth::createSession'],
        ['demo::routes::POST_orders', 'demo::auth::validateToken'],
        ['demo::routes::POST_orders', 'demo::orders::createOrder'],
        ['demo::routes::GET_products', 'demo::auth::validateToken'],
        ['demo::routes::GET_products', 'demo::products::searchProducts'],
        ['demo::orders::createOrder', 'demo::orders::processPayment'],
        ['demo::orders::createOrder', 'demo::orders::updateInventory'],
        ['demo::orders::createOrder', 'demo::orders::sendConfirmation'],
        ['demo::orders::createOrder', 'demo::users::getUser'],
        ['demo::products::searchProducts', 'demo::products::getCachedProduct'],
        ['demo::products::searchProducts', 'demo::products::getProduct'],
        ['demo::orders::processPayment', 'demo::users::getUser'],
      ];

      const edgeRows: EdgeInsert[] = edgeSeeds
        .map(([src, tgt]) => {
          const srcId = oirToId.get(src);
          const tgtId = oirToId.get(tgt);
          if (!srcId || !tgtId) return null;
          return { project_id: input.projectId, source_node_id: srcId, target_node_id: tgtId, type: 'calls' };
        })
        .filter((e): e is EdgeInsert => e !== null);

      if (edgeRows.length > 0) {
        await ctx.db.from('code_edges').insert(edgeRows);
      }

      // ── Demo error snapshots ───────────────────────────────────────────
      const processPaymentNodeId = oirToId.get('demo::orders::processPayment');
      const validateTokenNodeId = oirToId.get('demo::auth::validateToken');
      const updateInventoryNodeId = oirToId.get('demo::orders::updateInventory');

      const errorSeeds = [
        processPaymentNodeId && {
          project_id: input.projectId,
          code_node_id: processPaymentNodeId,
          error_type: 'PaymentGatewayError',
          error_message: 'Connection timeout after 30s — Stripe webhook endpoint unreachable',
          error_stack: 'PaymentGatewayError: Connection timeout\n  at processPayment (src/orders/payment.ts:42)\n  at createOrder (src/orders/service.ts:72)',
          fingerprint: `demo::payment_timeout::${input.projectId}`,
          occurrence_count: 47,
          first_seen_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          last_seen_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          severity: 'error',
          resolved: false,
          source: 'runtime',
          metadata: {
            narrative: {
              title: 'Payment Gateway Timeout Cascade',
              story: 'The Stripe webhook endpoint began timing out 7 days ago, causing createOrder to fail for ~12% of checkout attempts. The 30s timeout in processPayment is blocking order threads, leading to connection pool exhaustion under peak load.',
              blastRadius: ['POST /api/orders', 'createOrder', 'sendConfirmation'],
              likelyFix: 'Add circuit breaker with 5s timeout + exponential backoff, or switch to async payment confirmation via queue.',
              confidence: 'high',
            },
          },
        },
        validateTokenNodeId && {
          project_id: input.projectId,
          code_node_id: validateTokenNodeId,
          error_type: 'JsonWebTokenError',
          error_message: 'invalid signature — possible token replay attack from stale sessions',
          error_stack: 'JsonWebTokenError: invalid signature\n  at validateToken (src/auth/middleware.ts:28)\n  at POST /api/orders (src/routes/orders.ts:18)',
          fingerprint: `demo::jwt_invalid_sig::${input.projectId}`,
          occurrence_count: 14,
          first_seen_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
          last_seen_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          severity: 'warning',
          resolved: false,
          source: 'runtime',
          metadata: {},
        },
        updateInventoryNodeId && {
          project_id: input.projectId,
          code_node_id: updateInventoryNodeId,
          error_type: 'RaceConditionError',
          error_message: 'Inventory count went negative: item SKU-8821 shows -3 units',
          error_stack: 'RaceConditionError: Inventory count went negative\n  at updateInventory (src/orders/inventory.ts:38)',
          fingerprint: `demo::inventory_race::${input.projectId}`,
          occurrence_count: 8,
          first_seen_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          last_seen_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          severity: 'error',
          resolved: false,
          source: 'cli-static-analysis',
          metadata: {},
        },
      ].filter(Boolean);

      const filteredErrors = errorSeeds.filter((e): e is NonNullable<typeof e> => Boolean(e));
      if (filteredErrors.length > 0) {
        await ctx.db.from('error_snapshots').insert(filteredErrors as unknown as Database['public']['Tables']['error_snapshots']['Insert'][]);
      }

      // Update project to reflect demo state
      await ctx.db
        .from('projects')
        .update({
          last_indexed_at: new Date().toISOString(),
          status: 'active',
        } as object)
        .eq('id', input.projectId);

      return {
        seeded: true,
        nodes: insertedNodes.length,
        edges: edgeRows.length,
        errors: errorSeeds.length,
      };
    }),
});
