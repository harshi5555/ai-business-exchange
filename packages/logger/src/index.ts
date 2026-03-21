import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const createLogger = (serviceName: string) =>
  pino({
    name: serviceName,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: isDev
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
    formatters: {
      level: (label) => ({ level: label }),
    },
    base: { service: serviceName },
  });

export type Logger = ReturnType<typeof createLogger>;
