import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from '@trpc/server/adapters/fastify';
import { env } from './config/env.js';
import { getCorsConfig } from './config/cors.js';
import { loggerConfig, logger } from './lib/logger.js';
import { createContext } from './trpc/context.js';
import { appRouter, type AppRouter } from './routers/index.js';
import { createUserClient, supabaseAdmin } from './lib/supabase/client.js';
import { querySubgraphStream, buildProjectContext, type StreamEvent } from './services/graph-query.service.js';
import {
  callLLMStream,
  resolveApiKey,
  selectModel,
  SYSTEM_PROMPTS,
  compressSessionHistory,
  type LLMMessage,
} from './services/ai.service.js';

async function buildServer() {
  const server = Fastify({
    logger: loggerConfig,
    trustProxy: true, // required behind Docker/nginx/load balancer
    requestTimeout: 30_000,
    bodyLimit: 10 * 1024 * 1024, // 10 MB — accommodate large OIR payloads
    routerOptions: {
      maxParamLength: 5000,
    },
  });

  // ─── Security headers ──────────────────────────────────────────
  await server.register(helmet, {
    contentSecurityPolicy: false, // API-only server, no HTML served
  });

  // ─── CORS ──────────────────────────────────────────────────────
  await server.register(cors, getCorsConfig());

  // ─── Sensible error responses ──────────────────────────────────
  await server.register(sensible);

  // ─── Rate limiting ─────────────────────────────────────────────
  await server.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) => {
      // Rate limit by user ID if authenticated, otherwise by IP
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        // Use a hash of the token as the key (avoids storing tokens)
        return `user:${authHeader.slice(7, 47)}`;
      }
      return (
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        req.ip
      );
    },
  });

  // ─── Request ID propagation ────────────────────────────────────
  server.addHook('onRequest', async (req, reply) => {
    const requestId =
      (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
    reply.header('x-request-id', requestId);
  });

  // ─── tRPC adapter ─────────────────────────────────────────────
  await server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }) {
        logger.error(
          { path, code: error.code, message: error.message },
          `tRPC error on ${path}`,
        );
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });

  // ─── Plain health endpoint (for Docker/K8s probes) ────────────
  server.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // ─── Streaming standalone AI chat (SSE) ───────────────────────
  server.post<{
    Body: {
      projectId: string;
      sessionId: string;
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
      modelPreference?: 'auto' | 'fast' | 'powerful';
      apiKeyId?: string;
    };
  }>('/api/ai/stream-chat', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return reply.status(401).send({ error: 'Unauthorized' });

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, sessionId, messages, modelPreference, apiKeyId } = req.body ?? {};
    if (!projectId || typeof projectId !== 'string') {
      return reply.status(400).send({ error: 'projectId is required' });
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return reply.status(400).send({ error: 'sessionId is required' });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.status(400).send({ error: 'messages must be a non-empty array' });
    }

    const db = createUserClient(token);
    const resolvedKey = await resolveApiKey(user.id, db, { apiKeyId, projectId });
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const model = selectModel('graphQuery', lastUserMsg, resolvedKey.provider, modelPreference ?? 'auto');

    // Fetch per-project context (metadata + code summaries) so the AI knows what project it's working with
    const projectContext = await buildProjectContext(projectId, db, supabaseAdmin);

    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as import('node:http').OutgoingHttpHeaders),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: Record<string, unknown>) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const systemMessages: LLMMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS.chatAssistant },
    ];
    if (projectContext) {
      systemMessages.push({ role: 'system', content: projectContext });
    }

    const llmMessages: LLMMessage[] = compressSessionHistory([
      ...systemMessages,
      ...messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ]);

    let fullContent = '';
    try {
      for await (const delta of callLLMStream(llmMessages, resolvedKey, { model })) {
        fullContent += delta;
        sendEvent({ type: 'delta', text: delta });
      }
      sendEvent({ type: 'done' });

      // Best-effort: persist assistant message to the session
      if (fullContent) {
        try {
          const { data: session } = await supabaseAdmin
            .from('ai_sessions')
            .select('messages')
            .eq('id', sessionId)
            .eq('user_id', user.id)
            .single();

          if (session) {
            const existing = Array.isArray(session.messages) ? session.messages : [];
            await supabaseAdmin
              .from('ai_sessions')
              .update({
                messages: [
                  ...existing,
                  { role: 'assistant', content: fullContent, timestamp: new Date().toISOString() },
                ],
              })
              .eq('id', sessionId)
              .eq('user_id', user.id);
          }
        } catch {
          // Persistence is best-effort — do not fail the stream
        }
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (isAbort) {
        logger.warn({ projectId, userId: user.id }, 'SSE stream-chat aborted (client disconnect or inactivity)');
      } else {
        logger.error({ err, projectId, userId: user.id }, 'SSE stream-chat failed');
      }
      sendEvent({ type: 'error', message: err instanceof Error ? err.message : 'Stream failed' });
    } finally {
      reply.raw.end();
    }
  });

  // ─── Streaming AI graph query (SSE) ───────────────────────────
  server.post<{
    Body: {
      projectId: string;
      query: string;
      apiKeyId?: string;
      contextNodeIds?: string[];
      attachments?: Array<{ kind: string; id: string; label: string; subtype?: string }>;
      modelPreference?: 'auto' | 'fast' | 'powerful';
    };
  }>('/api/ai/stream-graph-query', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    // Authenticate
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Validate body
    const { projectId, query } = req.body ?? {};
    if (!projectId || typeof projectId !== 'string') {
      return reply.status(400).send({ error: 'projectId is required' });
    }
    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      return reply.status(400).send({ error: 'query must be at least 3 characters' });
    }

    const db = createUserClient(token);
    const { apiKeyId, contextNodeIds, attachments, modelPreference } = req.body;

    // Set SSE headers and begin streaming
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as import('node:http').OutgoingHttpHeaders),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: StreamEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const stream = querySubgraphStream(
        projectId,
        query.trim(),
        user.id,
        db,
        supabaseAdmin,
        apiKeyId,
        contextNodeIds,
        attachments as Array<{ kind: 'node' | 'module' | 'function' | 'file' | 'error'; id: string; label: string; subtype?: string }>,
        modelPreference,
      );
      for await (const event of stream) {
        sendEvent(event);
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (isAbort) {
        logger.warn({ projectId, userId: user.id }, 'SSE stream-graph-query aborted (client disconnect or inactivity)');
      } else {
        logger.error({ err, projectId, userId: user.id }, 'SSE stream-graph-query failed');
      }
      sendEvent({ type: 'error', message: err instanceof Error ? err.message : 'Stream failed' });
    } finally {
      reply.raw.end();
    }
  });

  // ─── Graceful shutdown ────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// ─── Start ────────────────────────────────────────────────────────
async function main() {
  const server = await buildServer();

  try {
    await server.listen({ port: env.PORT, host: env.HOST });
    logger.info(
      `🚀 Omnious API running at http://${env.HOST}:${env.PORT}`,
    );
    logger.info(`   tRPC endpoint: http://${env.HOST}:${env.PORT}/trpc`);
    logger.info(`   Environment: ${env.NODE_ENV}`);
  } catch (err) {
    logger.fatal(err, 'Failed to start server');
    process.exit(1);
  }
}

main();

export { buildServer };
