import pino from 'pino';
import type { LoggerOptions } from 'pino';
import { env } from '../config/env.js';

export const loggerConfig: LoggerOptions = {
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined, // JSON in production for structured log aggregation
  serializers: pino.stdSerializers,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-project-api-key"]',
    ],
    censor: '[REDACTED]',
  },
};

export const logger = pino(loggerConfig);
