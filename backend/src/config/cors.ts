import type { FastifyCorsOptions } from '@fastify/cors';
import { env } from './env.js';

/**
 * CORS configuration.
 * In production, restrict to your actual frontend domain(s).
 */
export function getCorsConfig(): FastifyCorsOptions {
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim());

  return {
    origin: env.NODE_ENV === 'development' ? true : origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Project-API-Key',
      'X-Request-ID',
    ],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 86_400, // 24h preflight cache
  };
}
