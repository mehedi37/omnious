import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, projectProcedure } from '../trpc/index.js';
import { logger } from '../lib/logger.js';
import { resolveApiKey, callLLM, selectModel, SYSTEM_PROMPTS, encryptApiKey } from '../services/ai.service.js';
import {
  querySubgraph,
  getOverviewGraph,
  getErrorSubgraph,
  getTraceSubgraph,
  getDependencySubgraph,
} from '../services/graph-query.service.js';

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
        messages: z.array(
          z.object({
            role: z.enum(['user', 'assistant', 'system']),
            content: z.string(),
          }),
        ),
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
      // Fetch current messages
      const { data: session, error: fetchError } = await ctx.db
        .from('ai_sessions')
        .select('messages, prompt_tokens, completion_tokens')
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
          `*, code_node:code_nodes (id, name, type, file_path, line_start, line_end, signature, doc_comment)`,
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

      // 6. Persist as an ai_session with type 'why_broke'
      const contextNodeIds = node?.id ? [String(node.id)] : [];
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
        })
        .select('id')
        .single();

      if (sessionError || !session) {
        logger.warn({ sessionError }, 'Failed to persist ai_session for explainError');
        return { sessionId: null, summary };
      }

      return { sessionId: session.id, summary };
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
});
