import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  ...(isProduction
    ? { formatters: { level: (label) => ({ level: label }) } }
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

export function initLogger() {
  if (isProduction) {
    globalThis.console.log = (...args: unknown[]) => logger.info(args.join(' '));
    globalThis.console.warn = (...args: unknown[]) => logger.warn(args.join(' '));
    globalThis.console.error = (...args: unknown[]) => logger.error(args.join(' '));
  }
  logger.info('Logger initialized');
}

export const graphLogger = logger.child({ module: 'graph' });
export const trpcLogger = logger.child({ module: 'trpc' });
export const authLogger = logger.child({ module: 'auth' });
