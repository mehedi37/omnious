import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, projectProcedure, apiKeyProcedure } from '../trpc/index.js';
import { logger } from '../lib/logger.js';
import { resolveApiKey, callLLM, selectModel, SYSTEM_PROMPTS, encryptApiKey, extractSessionInsights } from '../services/ai.service.js';
import {
  querySubgraph,
  getOverviewGraph,
  getErrorSubgraph,
  getTraceSubgraph,
  getDependencySubgraph,
} from '../services/graph-query.service.js';
import { generateSliceNarrative } from '../services/clustering.service.js';

const aiMessageAttachmentSchema = z.object({
  kind: z.enum(['node', 'module', 'function', 'file', 'error']),
  id: z.string().min(1),
  label: z.string().min(1),
  subtype: z.string().optional(),
});

const aiSessionMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string().datetime().optional(),
  attachments: z.array(aiMessageAttachmentSchema).optional(),
});

const aiSliceFiltersSchema = z.object({
  edgeIds: z.array(z.string().uuid()).optional(),
  query: z.string().optional(),
  explanation: z.string().optional(),
  source: z.literal('ai_gen').optional(),
});

export const aiRouter = router({
  /** Create a new AI debugging session */
  createSession: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        type: z.enum([
          'explain_flow',
          'why_broke',
          'fix_it',
          'general',
          'security_scan',
          'translate',
          'graph_query',
        ]),
        contextNodeIds: z.array(z.string().uuid()).optional(),
        contextTraceId: z.string().uuid().optional(),
        apiKeyId: z.string().uuid().optional(),
        modelPreference: z.enum(['auto', 'fast', 'powerful']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('ai_sessions')
        .insert({
          user_id: ctx.user.id,
          project_id: input.projectId,
          type: input.type,
          context_node_ids: input.contextNodeIds ?? [],
          context_trace_id: input.contextTraceId ?? null,
          api_key_id: input.apiKeyId ?? null,
        })
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

  /** Get an AI session with messages */
  getSession: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('ai_sessions')
        .select('*')
        .eq('id', input.sessionId)
        .eq('user_id', ctx.user.id)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'AI session not found',
        });
      }

      return data;
    }),

  /** Append a message to an AI session */
  appendMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        messages: z.array(aiSessionMessageSchema),
        tokenUsage: z
          .object({
            promptTokens: z.number().int().min(0),
            completionTokens: z.number().int().min(0),
            model: z.string(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Fetch current messages + project_id for insight extraction
      const { data: session, error: fetchError } = await ctx.db
        .from('ai_sessions')
        .select('messages, prompt_tokens, completion_tokens, project_id')
        .eq('id', input.sessionId)
        .eq('user_id', ctx.user.id)
        .single();

      if (fetchError || !session) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'AI session not found',
        });
      }

      const existingMessages = Array.isArray(session.messages)
        ? session.messages
        : [];
      const updatedMessages = [...existingMessages, ...input.messages];

      const updates: Record<string, unknown> = {
        messages: updatedMessages,
      };

      if (input.tokenUsage) {
        updates['prompt_tokens'] =
          (session.prompt_tokens ?? 0) + input.tokenUsage.promptTokens;
        updates['completion_tokens'] =
          (session.completion_tokens ?? 0) + input.tokenUsage.completionTokens;
        updates['total_tokens'] =
          (updates['prompt_tokens'] as number) +
          (updates['completion_tokens'] as number);
        updates['model'] = input.tokenUsage.model;
      }

      const { data, error } = await ctx.db
        .from('ai_sessions')
        .update(updates)
        .eq('id', input.sessionId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      // Fire-and-forget: extract insights when conversation has enough turns
      const hasAssistantMsg = input.messages.some((m) => m.role === 'assistant');
      if (hasAssistantMsg && session.project_id) {
        const allMsgs = updatedMessages as Array<{ role: string; content: string }>;
        extractSessionInsights(
          input.sessionId,
          session.project_id as string,
          ctx.user.id,
          allMsgs,
          ctx.adminDb,
        ).catch((err) => {
          logger.debug({ err, sessionId: input.sessionId }, 'Insight extraction failed (non-critical)');
        });
      }

      return data;
    }),

  /** List user's AI sessions for a project */
  listSessions: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, error, count } = await ctx.db
        .from('ai_sessions')
        .select('id, type, model, status, total_tokens, created_at, updated_at', {
          count: 'exact',
        })
        .eq('project_id', input.projectId)
        .eq('user_id', ctx.user.id)
        .order('updated_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { sessions: data, total: count ?? 0 };
    }),

  /**
   * Explain an error snapshot in natural language using an LLM.
   * Fetches context from the code node + graph traversal, calls the configured LLM,
   * and returns a natural-language summary + session ID.
   */
  explainError: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        errorId: z.string().uuid(),
        apiKeyId: z.string().uuid().optional(),
        modelPreference: z.enum(['auto', 'fast', 'powerful']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Fetch the error snapshot with its linked code node
      const { data: errorSnap, error: snapError } = await ctx.db
        .from('error_snapshots')
        .select(
          `*, code_node:code_nodes (id, name, type, file_path, line_start, line_end, signature, doc_comment, code_body)`,
        )
        .eq('id', input.errorId)
        .eq('project_id', input.projectId)
        .single();

      if (snapError || !errorSnap) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Error snapshot not found' });
      }

      // 2. Resolve API key (BYOK or platform) using the service
      let resolvedKey;
      try {
        resolvedKey = await resolveApiKey(ctx.user.id, ctx.db, {
          apiKeyId: input.apiKeyId,
          projectId: input.projectId,
        });
      } catch {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'AI is not configured. Ensure Ollama is running and OLLAMA_* environment variables are set.',
        });
      }

      // 3. Build rich context from the linked node, graph, errors, and traces
      const contextSections: string[] = [];
      const node = errorSnap.code_node as Record<string, unknown> | null;

      // ── 3a. Affected code node ──
      if (node) {
        const codeParts: string[] = [
          `**${String(node.name ?? 'Unknown')}** (${String(node.type ?? '?')}) in \`${String(node.file_path ?? '?')}:${String(node.line_start ?? '?')}\``,
        ];
        if (node.signature) codeParts.push(`Signature: \`${String(node.signature)}\``);
        if (node.doc_comment) codeParts.push(`Docs: ${String(node.doc_comment)}`);
        if (node.code_body) {
          const codeSnippet = String(node.code_body).slice(0, 3000);
          codeParts.push(`\n### Source Code\n\`\`\`\n${codeSnippet}\n\`\`\``);
        }
        contextSections.push(`## Affected Code\n${codeParts.join('\n')}`);
      }

      // ── 3b. 2-hop graph neighborhood ──
      if (node) {
        const { data: neighbors } = await ctx.db.rpc('traverse_graph', {
          p_node_id: String(node.id),
          p_direction: 'both',
          p_max_depth: 2,
        });

        if (neighbors && neighbors.length > 0) {
          type TraversalRow = Record<string, unknown>;
          const graphLines = (neighbors as TraversalRow[])
            .slice(0, 20)
            .map((n) => {
              const depth = Number(n.depth ?? 0);
              const direction = String(n.direction ?? '');
              const arrow = direction === 'outgoing' ? '→' : '←';
              const indent = depth > 1 ? '  ' : '';
              const edgeType = n.edge_type ? ` [${String(n.edge_type)}]` : '';
              return `${indent}${arrow}${edgeType} ${String(n.name ?? '?')} (${String(n.type ?? '?')}) — \`${String(n.file_path ?? '?')}\``;
            });
          contextSections.push(`## Graph Context (2-hop)\n${graphLines.join('\n')}`);
        }
      }

      // ── 3c. Error cluster — other errors on same node ──
      if (node?.id) {
        const { data: relatedErrors } = await ctx.db
          .from('error_snapshots')
          .select('error_type, error_message, occurrence_count, source, last_seen_at')
          .eq('project_id', input.projectId)
          .eq('code_node_id', String(node.id))
          .neq('id', input.errorId)
          .order('occurrence_count', { ascending: false })
          .limit(5);

        if (relatedErrors && relatedErrors.length > 0) {
          const errorLines = relatedErrors.map(
            (e) =>
              `- **${e.error_type ?? 'Error'}**: ${(e.error_message ?? '').slice(0, 120)} (×${e.occurrence_count}, source: ${e.source ?? '?'})`,
          );
          contextSections.push(
            `## Error Patterns\nThis node has ${relatedErrors.length} other error type(s):\n${errorLines.join('\n')}`,
          );
        }
      }

      // ── 3d. Trace waterfall (if error is linked to a trace) ──
      if (errorSnap.trace_id) {
        const { data: spans } = await ctx.db
          .from('spans')
          .select('operation, service_name, duration_ms, status, error_message, kind')
          .eq('trace_id', errorSnap.trace_id)
          .order('started_at', { ascending: true })
          .limit(15);

        if (spans && spans.length > 0) {
          const traceLines = spans.map((s) => {
            const status = s.status === 'error' ? ' ❌' : ' ✓';
            const dur = s.duration_ms != null ? ` (${s.duration_ms}ms)` : '';
            const svc = s.service_name ? `[${s.service_name}] ` : '';
            const err = s.error_message ? ` — ${s.error_message.slice(0, 80)}` : '';
            return `- ${svc}${s.operation ?? '?'}${dur}${status}${err}`;
          });
          contextSections.push(`## Trace Timeline\n${traceLines.join('\n')}`);
        }
      }

      // 4. Build the structured prompt
      const userPrompt = [
        `## Error`,
        `**Type:** ${errorSnap.error_type ?? 'Unknown'}`,
        `**Message:** ${errorSnap.error_message}`,
        errorSnap.error_stack ? `**Stack trace (truncated):**\n\`\`\`\n${errorSnap.error_stack.slice(0, 1500)}\n\`\`\`` : '',
        `**Occurrences:** ${errorSnap.occurrence_count} time(s) since ${errorSnap.first_seen_at?.slice(0, 10) ?? 'unknown'}`,
        `**Source:** ${errorSnap.source ?? 'runtime'}`,
        errorSnap.language ? `**Language:** ${errorSnap.language}` : '',
        '',
        ...contextSections,
      ]
        .filter(Boolean)
        .join('\n');

      // 5. Call the LLM via service
      let summary = '';
      try {
        const selectedModel = selectModel(
          'errorExplain',
          errorSnap.error_message ?? '',
          resolvedKey.provider,
          input.modelPreference,
        );
        const llmResult = await callLLM(
          [
            { role: 'system', content: SYSTEM_PROMPTS.errorExplain },
            { role: 'user', content: userPrompt },
          ],
          resolvedKey,
          { maxTokens: 1024, model: selectedModel },
        );
        summary = llmResult.content;
      } catch (err) {
        logger.warn({ err, errorId: input.errorId }, 'LLM call failed in explainError');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `AI call failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      if (!summary) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'AI returned an empty response.',
        });
      }

      // 6. Reuse existing debug session for this node, or create a new one
      const contextNodeIds = node?.id ? [String(node.id)] : [];
      let sessionId: string | null = null;

      if (contextNodeIds.length > 0) {
        const { data: existingSession } = await ctx.db
          .from('ai_sessions')
          .select('id, messages')
          .eq('project_id', input.projectId)
          .eq('user_id', ctx.user.id)
          .contains('context_node_ids', contextNodeIds)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingSession) {
          sessionId = existingSession.id;
          const existingMsgs = Array.isArray(existingSession.messages) ? existingSession.messages : [];
          await ctx.db
            .from('ai_sessions')
            .update({
              messages: [
                ...existingMsgs,
                { role: 'user', content: userPrompt },
                { role: 'assistant', content: summary },
              ],
            })
            .eq('id', sessionId)
            .eq('user_id', ctx.user.id);
        }
      }

      if (!sessionId) {
        const nodeName = node ? String((node as { name?: unknown }).name ?? 'Unknown') : 'Error';
        const { data: session, error: sessionError } = await ctx.db
          .from('ai_sessions')
          .insert({
            user_id: ctx.user.id,
            project_id: input.projectId,
            type: 'why_broke' as const,
            context_node_ids: contextNodeIds,
            messages: [
              { role: 'user', content: userPrompt },
              { role: 'assistant', content: summary },
            ],
            status: 'active',
            metadata: { name: `${nodeName} debug` },
          })
          .select('id')
          .single();

        if (sessionError || !session) {
          logger.warn({ sessionError }, 'Failed to persist ai_session for explainError');
          return { sessionId: null, summary };
        }
        sessionId = session.id;
      }

      return { sessionId, summary };
    }),

  /** Manage BYOK API keys */
  listApiKeys: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.db
      .from('user_api_keys')
      .select('id, provider, label, key_prefix, is_active, last_used_at, created_at')
      .eq('user_id', ctx.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error.message,
      });
    }

    return data;
  }),

  /** Store a new API key (BYOK) */
  addApiKey: protectedProcedure
    .input(
      z.object({
        provider: z.enum(['openai', 'anthropic', 'ollama']),
        label: z.string().min(1).max(100).default('Default'),
        rawKey: z.string().min(1),
        keyPrefix: z.string().max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ciphertext = encryptApiKey(input.rawKey);

      const { data, error } = await ctx.db
        .from('user_api_keys')
        .insert({
          user_id: ctx.user.id,
          provider: input.provider,
          label: input.label,
          encrypted_key: ciphertext,
          key_prefix: input.keyPrefix ?? null,
        })
        .select('id, provider, label, key_prefix, is_active, created_at')
        .single();

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      await ctx.adminDb.from('api_key_audit_log').insert({
        key_id: data.id,
        user_id: ctx.user.id,
        action: 'created',
        key_prefix: input.keyPrefix ?? null,
        provider: input.provider,
        metadata: { label: input.label },
      });

      return data;
    }),

  /** Delete an API key */
  deleteApiKey: protectedProcedure
    .input(z.object({ keyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: keyMeta } = await ctx.db
        .from('user_api_keys')
        .select('key_prefix, provider, label')
        .eq('id', input.keyId)
        .eq('user_id', ctx.user.id)
        .single();

      const { error } = await ctx.db
        .from('user_api_keys')
        .delete()
        .eq('id', input.keyId)
        .eq('user_id', ctx.user.id);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      await ctx.adminDb.from('api_key_audit_log').insert({
        key_id: input.keyId,
        user_id: ctx.user.id,
        action: 'deleted',
        key_prefix: keyMeta?.key_prefix ?? null,
        provider: keyMeta?.provider ?? null,
        metadata: { label: keyMeta?.label },
      });

      return { success: true };
    }),

  // ─── AI-Driven Graph Query Procedures ────────────────────────

  /**
   * Primary AI query — ask anything about your codebase.
   * Embeds the query → vector search → traverse → LLM explain.
   * Returns a focused subgraph + natural language explanation.
   */
  queryGraph: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        query: z.string().min(3).max(2000),
        apiKeyId: z.string().uuid().optional(),
        contextNodeIds: z.array(z.string().uuid()).max(10).optional(),
        attachments: z.array(aiMessageAttachmentSchema).max(20).optional(),
        modelPreference: z.enum(['auto', 'fast', 'powerful']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await querySubgraph(
          input.projectId,
          input.query,
          ctx.user.id,
          ctx.db,
          ctx.adminDb,
          input.apiKeyId,
          input.contextNodeIds,
          input.attachments,
          input.modelPreference,
        );
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err, projectId: input.projectId }, 'queryGraph failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Graph query failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /**
   * Get overview graph for the landing page.
   * Returns high-level structural nodes (modules, packages, routes).
   */
  getOverview: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getOverviewGraph(input.projectId, ctx.adminDb);
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err, projectId: input.projectId }, 'getOverview failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load overview graph',
        });
      }
    }),

  /**
   * Get error-focused subgraph — nodes with recent errors + neighbors.
   */
  queryErrors: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getErrorSubgraph(input.projectId, ctx.db, ctx.adminDb, input.limit);
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err, projectId: input.projectId }, 'queryErrors failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load error subgraph',
        });
      }
    }),

  /**
   * Get trace subgraph — spans linked to code nodes.
   */
  queryTrace: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        traceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getTraceSubgraph(input.projectId, input.traceId, ctx.db, ctx.adminDb);
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err, projectId: input.projectId }, 'queryTrace failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load trace subgraph',
        });
      }
    }),

  /**
   * Get dependency subgraph — upstream callers or downstream deps of a node.
   */
  queryDependencies: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        nodeId: z.string().uuid(),
        direction: z.enum(['upstream', 'downstream', 'both']).default('both'),
        maxDepth: z.number().int().min(1).max(10).default(3),
      }),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await getDependencySubgraph(
          input.projectId,
          input.nodeId,
          input.direction,
          input.maxDepth,
          ctx.db,
          ctx.adminDb,
        );
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err, projectId: input.projectId }, 'queryDependencies failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load dependency subgraph',
        });
      }
    }),

  /**
   * Persist an AI-generated graph slice and return an ID for ai_gen URLs.
   */
  saveGraphSlice: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).optional(),
        nodeIds: z.array(z.string().uuid()).min(1).max(300),
        edgeIds: z.array(z.string().uuid()).max(1000).optional(),
        query: z.string().max(2000).optional(),
        explanation: z.string().max(20000).optional(),
        isShared: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const filters = {
        source: 'ai_gen' as const,
        edgeIds: input.edgeIds ?? [],
        query: input.query,
        explanation: input.explanation,
      };

      const { data, error } = await ctx.db
        .from('saved_views')
        .insert({
          project_id: input.projectId,
          user_id: ctx.user.id,
          name: input.name ?? 'AI graph slice',
          description: input.description ?? null,
          visible_nodes: input.nodeIds,
          filters,
          is_shared: input.isShared ?? false,
        })
        .select('id, created_at')
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message ?? 'Failed to save graph slice',
        });
      }

      return { viewId: data.id, createdAt: data.created_at };
    }),

  /**
   * Generate a natural language narrative for a saved graph slice.
   * Persists the narrative into saved_views.narrative and returns it.
   */
  generateNarrative: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        viewId: z.string().uuid(),
        nodes: z.array(z.object({ name: z.string(), type: z.string(), file_path: z.string() })).min(1).max(300),
        edges: z.array(z.object({ source: z.string(), target: z.string(), type: z.string() })).max(1000),
        query: z.string().max(2000),
        explanation: z.string().max(20000),
        apiKeyId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let resolvedKey;
      try {
        resolvedKey = await resolveApiKey(ctx.user.id, ctx.db, {
          apiKeyId: input.apiKeyId,
          projectId: input.projectId,
        });
      } catch {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AI is not configured. Ensure Ollama is running or add an API key.',
        });
      }

      const narrative = await generateSliceNarrative(
        input.nodes,
        input.edges,
        input.query,
        input.explanation,
        resolvedKey,
      );

      // Persist narrative to saved_views (best-effort)
      await ctx.db
        .from('saved_views')
        .update({ narrative: JSON.parse(JSON.stringify(narrative)) })
        .eq('id', input.viewId)
        .eq('project_id', input.projectId);

      return narrative;
    }),

  /**
   * Load a persisted AI graph slice by ID.
   */
  getGraphSlice: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        viewId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: view, error: viewError } = await ctx.db
        .from('saved_views')
        .select('id, name, description, visible_nodes, filters, user_id, is_shared, narrative')
        .eq('id', input.viewId)
        .eq('project_id', input.projectId)
        .single();

      if (viewError || !view) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Saved graph slice not found',
        });
      }

      if (view.user_id !== ctx.user.id && !view.is_shared) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this graph slice',
        });
      }

      const nodeIds = view.visible_nodes ?? [];
      if (nodeIds.length === 0) {
        return {
          nodes: [],
          edges: [],
          explanation: null,
          query: null,
          narrative: null,
          viewId: view.id,
        };
      }

      const filtersParsed = aiSliceFiltersSchema.safeParse(view.filters ?? {});
      const filterData = filtersParsed.success ? filtersParsed.data : {};

      const { data: nodes, error: nodesError } = await ctx.adminDb
        .from('code_nodes')
        .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
        .eq('project_id', input.projectId)
        .in('id', nodeIds);

      if (nodesError) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load slice nodes',
        });
      }

      const edgeIds = filterData.edgeIds ?? [];
      const edgeQuery = ctx.adminDb
        .from('code_edges')
        .select('id, source_node_id, target_node_id, type, metadata')
        .eq('project_id', input.projectId);

      const { data: edges, error: edgesError } = edgeIds.length > 0
        ? await edgeQuery.in('id', edgeIds)
        : await edgeQuery.in('source_node_id', nodeIds).in('target_node_id', nodeIds);

      if (edgesError) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to load slice edges',
        });
      }

      return {
        viewId: view.id,
        name: view.name,
        description: view.description,
        query: filterData.query ?? null,
        explanation: filterData.explanation ?? null,
        narrative: (view.narrative as Record<string, unknown> | null) ?? null,
        nodes: (nodes ?? []).map((n: Record<string, unknown>) => ({
          id: String(n.id),
          oir_id: String(n.oir_id),
          type: String(n.type),
          name: String(n.name),
          file_path: String(n.file_path),
          line_start: (n.line_start as number | null) ?? null,
          line_end: (n.line_end as number | null) ?? null,
          signature: (n.signature as string | null) ?? null,
          doc_comment: (n.doc_comment as string | null) ?? null,
          metadata: (n.metadata as Record<string, unknown> | null) ?? null,
          source: 'seed' as const,
        })),
        edges: (edges ?? []).map((e: Record<string, unknown>) => ({
          id: String(e.id),
          source_node_id: String(e.source_node_id),
          target_node_id: String(e.target_node_id),
          type: String(e.type),
          metadata: (e.metadata as Record<string, unknown> | null) ?? null,
        })),
      };
    }),

  /**
   * List recent AI-generated graph slices for this project.
   */
  listGraphSlices: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        limit: z.number().int().min(1).max(30).default(8),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Filter source='ai_gen' at DB level using JSONB containment — avoids fetching 3× and filtering in JS
      const { data, error } = await ctx.db
        .from('saved_views')
        .select('id, name, description, is_shared, created_at, updated_at, filters, user_id')
        .eq('project_id', input.projectId)
        .or(`user_id.eq.${ctx.user.id},is_shared.eq.true`)
        .contains('filters', { source: 'ai_gen' })
        .order('updated_at', { ascending: false })
        .limit(input.limit);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      const slices = (data ?? [])
        .map((row: Record<string, unknown>) => ({
          viewId: String(row.id),
          name: String(row.name ?? 'AI graph slice'),
          description: (row.description as string | null) ?? null,
          isShared: Boolean(row.is_shared),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          isOwnedByCurrentUser: String(row.user_id) === ctx.user.id,
        }));

      return { slices };
    }),

  /**
   * Delete a user-owned graph slice.
   */
  deleteGraphSlice: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        viewId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.db
        .from('saved_views')
        .delete()
        .eq('id', input.viewId)
        .eq('project_id', input.projectId)
        .eq('user_id', ctx.user.id);

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return { success: true };
    }),

  // ─── OIR-Based Graph Slices (portable across re-indexes) ───

  /**
   * Save a graph slice using oir_id references (not UUIDs).
   * These slices survive re-indexes since oir_ids are deterministic.
   */
  saveAiSlice: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1).max(200),
        explanationMd: z.string().max(20000),
        nodeOirIds: z.array(z.string()).min(1).max(300),
        edgePairs: z.array(z.object({
          source: z.string(),
          target: z.string(),
          type: z.string(),
        })).max(1000).default([]),
        entryPointOirId: z.string().nullish(),
        queryText: z.string().max(2000).nullish(),
        sessionId: z.string().uuid().nullish(),
        sliceType: z.enum(['ai_generated', 'user_saved', 'auto_explain']).default('ai_generated'),
        tags: z.array(z.string()).max(20).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await (ctx.db
        .from('ai_graph_slices' as any) as any)
        .insert({
          project_id: input.projectId,
          user_id: ctx.user.id,
          session_id: input.sessionId ?? null,
          title: input.title,
          explanation_md: input.explanationMd,
          node_oir_ids: input.nodeOirIds,
          edge_pairs: input.edgePairs,
          entry_point_oir_id: input.entryPointOirId ?? null,
          query_text: input.queryText ?? null,
          slice_type: input.sliceType,
          tags: input.tags,
        })
        .select('id, created_at')
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error?.message ?? 'Failed to save AI graph slice',
        });
      }

      return { sliceId: data.id, createdAt: data.created_at };
    }),

  /**
   * Load an AI graph slice and resolve oir_ids back to current node data.
   */
  getAiSlice: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        sliceId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data: slice, error: sliceError } = await (ctx.db
        .from('ai_graph_slices' as any) as any)
        .select('*')
        .eq('id', input.sliceId)
        .eq('project_id', input.projectId)
        .single();

      if (sliceError || !slice) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'AI graph slice not found' });
      }

      // Resolve oir_ids to current node data
      const { data: nodes, error: nodesError } = await ctx.adminDb
        .from('code_nodes')
        .select('id, oir_id, type, name, file_path, line_start, line_end, signature, doc_comment, metadata')
        .eq('project_id', input.projectId)
        .in('oir_id', slice.node_oir_ids ?? []);

      if (nodesError) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to resolve slice nodes' });
      }

      // Resolve edges by matching source/target oir_ids in the project
      const resolvedNodes = nodes ?? [];
      const nodeIdSet = new Set(resolvedNodes.map((n: Record<string, unknown>) => String(n.id)));
      const nodeIds = [...nodeIdSet];

      const { data: edges } = nodeIds.length > 0
        ? await ctx.adminDb
          .from('code_edges')
          .select('id, source_node_id, target_node_id, type, metadata')
          .eq('project_id', input.projectId)
          .in('source_node_id', nodeIds)
          .in('target_node_id', nodeIds)
        : { data: [] };

      return {
        sliceId: slice.id,
        title: slice.title,
        explanationMd: slice.explanation_md,
        queryText: slice.query_text,
        entryPointOirId: slice.entry_point_oir_id,
        sliceType: slice.slice_type,
        tags: slice.tags ?? [],
        createdAt: slice.created_at,
        nodes: resolvedNodes.map((n: Record<string, unknown>) => ({
          id: String(n.id),
          oir_id: String(n.oir_id),
          type: String(n.type),
          name: String(n.name),
          file_path: String(n.file_path),
          line_start: n.line_start as number | null,
          line_end: n.line_end as number | null,
          signature: n.signature as string | null,
          doc_comment: n.doc_comment as string | null,
          metadata: n.metadata as Record<string, unknown> | null,
          source: 'seed' as const,
        })),
        edges: (edges ?? []).map((e: Record<string, unknown>) => ({
          id: String(e.id),
          source_node_id: String(e.source_node_id),
          target_node_id: String(e.target_node_id),
          type: String(e.type),
          metadata: e.metadata as Record<string, unknown> | null,
        })),
      };
    }),

  /**
   * List AI graph slices for a project.
   */
  listAiSlices: projectProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, error } = await (ctx.db
        .from('ai_graph_slices' as any) as any)
        .select('id, title, query_text, slice_type, tags, entry_point_oir_id, created_at, updated_at, user_id')
        .eq('project_id', input.projectId)
        .order('created_at', { ascending: false })
        .limit(input.limit);

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      }

      return {
        slices: (data ?? []).map((row: Record<string, unknown>) => ({
          sliceId: String(row.id),
          title: String(row.title ?? ''),
          queryText: (row.query_text as string | null) ?? null,
          sliceType: String(row.slice_type ?? 'ai_generated'),
          tags: (row.tags as string[]) ?? [],
          entryPointOirId: (row.entry_point_oir_id as string | null) ?? null,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          isOwnedByCurrentUser: String(row.user_id) === ctx.user.id,
        })),
      };
    }),

  /** Check what AI context layers are available for a project */
  getContextStatus: projectProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const pid = input.projectId;

      // Check code summaries (Tier 2 context)
      const { count: summaryCount } = await ctx.db
        .from('code_summaries')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid);

      // Check project documents (Tier 3 context)
      const { count: docCount } = await ctx.db
        .from('project_documents')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid);

      // Check past session insights (conversation memory)
      const { count: insightCount } = await ctx.db
        .from('ai_session_insights')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .eq('user_id', ctx.user.id);

      // Check project metadata (Tier 1 — always present if project exists)
      const { data: project } = await ctx.db
        .from('projects')
        .select('id, settings')
        .eq('id', pid)
        .single();

      const hasProfile = !!(project?.settings as Record<string, unknown> | null)?.ai_profile;

      return {
        hasProfile,
        summaryCount: summaryCount ?? 0,
        docCount: docCount ?? 0,
        insightCount: insightCount ?? 0,
      };
    }),

  // ── MCP / API-Key-Authenticated Endpoints ──

  /** Query the code graph using an API key (for MCP server / external integrations) */
  queryGraphFromAPI: apiKeyProcedure
    .input(
      z.object({
        projectApiKey: z.string(),
        query: z.string().min(3).max(2000),
        contextNodeIds: z.array(z.string().uuid()).max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve workspace owner as the userId for API key resolution
      const { data: workspace } = await ctx.adminDb
        .from('workspaces')
        .select('owner_id')
        .eq('id', ctx.apiKeyProject.workspace_id)
        .single();

      const userId = workspace?.owner_id ?? '00000000-0000-0000-0000-000000000000';

      try {
        return await querySubgraph(
          ctx.apiKeyProject.id,
          input.query,
          userId,
          ctx.adminDb,
          ctx.adminDb,
          undefined,
          input.contextNodeIds,
        );
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        logger.error({ err, projectId: ctx.apiKeyProject.id }, 'queryGraphFromAPI failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Graph query failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /** Search code nodes by name (for MCP server) */
  searchNodesFromAPI: apiKeyProcedure
    .input(
      z.object({
        projectApiKey: z.string(),
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(20).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.adminDb
        .from('code_nodes')
        .select('id, name, type, file_path, line_start, line_end, signature, doc_comment, code_body')
        .eq('project_id', ctx.apiKeyProject.id)
        .ilike('name', `%${input.query}%`)
        .limit(input.limit);

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      }

      return { nodes: data ?? [] };
    }),

  /** Get AI overview for a project via API key (for MCP server) */
  getOverviewFromAPI: apiKeyProcedure
    .input(z.object({ projectApiKey: z.string() }))
    .query(async ({ ctx }) => {
      try {
        return await getOverviewGraph(
          ctx.apiKeyProject.id,
          ctx.adminDb,
        );
      } catch (err) {
        logger.error({ err, projectId: ctx.apiKeyProject.id }, 'getOverviewFromAPI failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Overview failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
});
