import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, projectProcedure } from '../trpc/index.js';

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
        provider: z.string().min(1),
        label: z.string().min(1).max(100).default('Default'),
        encryptedKey: z.string().min(1),
        keyPrefix: z.string().max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.db
        .from('user_api_keys')
        .insert({
          user_id: ctx.user.id,
          provider: input.provider,
          label: input.label,
          encrypted_key: input.encryptedKey,
          key_prefix: input.keyPrefix ?? null,
        })
        .select('id, provider, label, key_prefix')
        .single();

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message,
        });
      }

      return data;
    }),

  /** Delete an API key */
  deleteApiKey: protectedProcedure
    .input(z.object({ keyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
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

      return { success: true };
    }),
});
