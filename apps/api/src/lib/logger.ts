import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import {
  createLogger as createWinstonLogger,
  format,
  transports,
} from 'winston';

export type LoggerLevel =
  'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

type LogFields = Record<string, unknown>;
type LogInput = LogFields | string;
type LogMethod = (input?: LogInput, message?: string) => void;

export interface Logger {
  debug: LogMethod;
  error: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  close?: () => Promise<void>;
}

export type LoggerOptions = {
  level: LoggerLevel;
  service: string;
  logDirectory?: string;
};

const SENSITIVE_KEYS = new Set([
  'authorization',
  'identityproof',
  'servicetoken',
  'cookie',
  'password',
  'passwordhash',
  'token',
  'sessiontoken',
  'captchatoken',
  'apikey',
  'email',
  'phone',
  'contact',
  'contactemail',
  'contactphone',
]);

const LEVEL_MAP: Record<LoggerLevel, string> = {
  fatal: 'error',
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'debug',
  trace: 'silly',
  silent: 'error',
};

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return { name: value.name };
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  const result = Array.isArray(value)
    ? value.map((item) => redact(item, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          SENSITIVE_KEYS.has(key.toLowerCase())
            ? '[REDACTED]'
            : redact(item, seen),
        ]),
      );

  seen.delete(value);
  return result;
}

function createLineFormat() {
  return format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.printf((entry) => {
      const { timestamp, level, message, ...details } = entry;
      const serializedDetails = JSON.stringify(
        details,
        (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
      );
      const suffix =
        serializedDetails && serializedDetails !== '{}'
          ? ` | ${serializedDetails}`
          : '';
      return `${timestamp} | ${String(level).toUpperCase()} | ${String(message)}${suffix}`;
    }),
  );
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

export function createLogger(
  { level, service, logDirectory = join(process.cwd(), 'logs') }: LoggerOptions,
  destination?: Writable,
): Logger {
  if (level === 'silent') {
    const noop = () => undefined;
    return {
      debug: noop,
      error: noop,
      info: noop,
      warn: noop,
      close: async () => undefined,
    };
  }

  if (!destination) {
    mkdirSync(logDirectory, { recursive: true });
  }

  const lineFormat = createLineFormat();
  const transportOptions = {
    maxsize: 5 * 1024 * 1024,
    maxFiles: 5,
    tailable: true,
    format: lineFormat,
  };
  const logger = createWinstonLogger({
    level: LEVEL_MAP[level],
    transports: destination
      ? [new transports.Stream({ format: lineFormat, stream: destination })]
      : [
          new transports.Console({ format: lineFormat }),
          new transports.File({
            ...transportOptions,
            filename: join(logDirectory, `${service}.log`),
          }),
          new transports.File({
            ...transportOptions,
            filename: join(logDirectory, `${service}-error.log`),
            level: 'error',
          }),
        ],
  });

  const write = (
    outputLevel: Exclude<LoggerLevel, 'silent'>,
    input?: LogInput,
    message?: string,
  ) => {
    const inputFields =
      typeof input === 'object' && input !== null
        ? (redact(input) as LogFields)
        : {};
    const text =
      message ??
      (typeof input === 'string'
        ? input
        : typeof inputFields.message === 'string'
          ? inputFields.message
          : 'Log event');
    delete inputFields.message;

    logger.log({
      ...inputFields,
      level: LEVEL_MAP[outputLevel],
      message: text,
      service,
    });
  };

  return {
    debug: (input, message) => write('debug', input, message),
    error: (input, message) => write('error', input, message),
    info: (input, message) => write('info', input, message),
    warn: (input, message) => write('warn', input, message),
    close: () =>
      new Promise<void>((resolve, reject) => {
        logger.once('finish', resolve);
        logger.once('error', reject);
        logger.end();
      }),
  };
}
