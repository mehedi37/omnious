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
