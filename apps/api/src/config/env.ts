import { LocaleSchema, type Locale } from '@tutwithus/contracts';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { LoggerLevel } from '../lib/logger.js';
import {
  DEFAULT_SERVER_VAD,
  type RealtimeTurnDetection,
} from '../core/session/realtime-session-config.js';

type LevelWithSilent = LoggerLevel;

const CorsOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  }, 'Must be an HTTP(S) origin without a path.');

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .url()
    .refine(
      (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
      'Must be a Redis URL.',
    )
    .optional(),
);

const EnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),
    API_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(CorsOriginSchema)),
    ADMIN_JWT_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(1),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    MONGODB_URI: z.string().min(1),
    TUTWITHUS_API_URL: z
      .preprocess(
        (value) => (value === '' ? undefined : value),
        z.url().default('https://api.tutwithus.com'),
      )
      .refine((value) => {
        try {
          const protocol = new URL(value).protocol;
          return protocol === 'http:' || protocol === 'https:';
        } catch {
          return false;
        }
      }, 'Must be an HTTP(S) URL.'),
    TUTWITHUS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(30_000)
      .default(5000),
    TUTWITHUS_AUTH_LOGIN_PATH: z.string().trim().min(1).default('/auth/login'),
    TUTWITHUS_LOOKUP_PATH: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
    REDIS_URL: optionalUrl,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    ADMIN_JWT_SECRET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(32).optional(),
    ),

    // The key is optional in development; production requires it.
    // An empty value (OPENAI_API_KEY=) counts as not set.
    OPENAI_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    OPENAI_REALTIME_MODEL: z.string().min(1).default('gpt-realtime-2.1-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    VOICE_TURN_DETECTION: z
      .enum(['server_vad', 'semantic_vad'])
      .default('server_vad'),
    VOICE_VAD_THRESHOLD: z.coerce
      .number()
      .min(0)
      .max(1)
      .default(DEFAULT_SERVER_VAD.threshold),
    VOICE_SILENCE_MS: z.coerce
      .number()
      .int()
      .min(200)
      .max(2000)
      .default(DEFAULT_SERVER_VAD.silence_duration_ms),
    VOICE_VAD_EAGERNESS: z
      .enum(['auto', 'low', 'medium', 'high'])
      .default('auto'),
    ELEVENLABS_API_KEY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    ELEVENLABS_SAUDI_ARABIC_VOICE_ID: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
    ELEVENLABS_MODEL_ID: z.string().min(1).default('eleven_multilingual_v2'),

    CONSENT_VERSION: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}\.\d+$/)
      .default('2026-11-04.1'),
    CONSENT_TEXT_AR: z.string().trim().min(1),
    CONSENT_TEXT_EN: z.string().trim().min(1),
    CONSENT_TEXT_FR: z.string().trim().min(1),
    MAX_CALL_SEC: z.coerce.number().int().positive().default(300),
    // Calls running at once across the API (PDF: cost and abuse caps).
    MAX_CONCURRENT_CALLS: z.coerce.number().int().positive().default(20),
    // A call with no speech for this long is ended politely.
    IDLE_TIMEOUT_SEC: z.coerce.number().int().min(5).max(600).default(90),
    RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    WHATSAPP_APP_SECRET: optionalSecret,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalSecret,
  })
  .refine(
    (env) =>
      (env.WHATSAPP_APP_SECRET === undefined) ===
      (env.WHATSAPP_WEBHOOK_VERIFY_TOKEN === undefined),
    {
      path: ['WHATSAPP_WEBHOOK_VERIFY_TOKEN'],
      message:
        'Configure both WHATSAPP_APP_SECRET and WHATSAPP_WEBHOOK_VERIFY_TOKEN, or leave both unset.',
    },
  )
  .refine(
    (env) => env.NODE_ENV !== 'production' || env.OPENAI_API_KEY !== undefined,
    { path: ['OPENAI_API_KEY'], message: 'Required in production.' },
  )
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' || env.ADMIN_JWT_SECRET !== undefined,
    { path: ['ADMIN_JWT_SECRET'], message: 'Required in production.' },
  );

export type ApiConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  trustProxyHops: number;
  corsAllowedOrigins: string[];
  logLevel: LevelWithSilent;
  mongoUri: string;
  tutWithUs?: {
    baseUrl: string;
    timeoutMs: number;
    authLoginPath: string;
    lookupPath?: string;
  };
  redisUrl?: string;
  workerConcurrency: number;
  adminJwtSecret: string;
  adminJwtSecretIsEphemeral: boolean;
  adminJwtTtlDays: number;
  openai: {
    apiKey: string | undefined;
    realtimeModel: string;
    embeddingModel: string;
    turnDetection?: RealtimeTurnDetection;
  };
  elevenLabs: {
    apiKey: string | undefined;
    saudiArabicVoiceId: string | undefined;
    modelId: string;
  };
  consentVersion: string;
  consentText: Record<Locale, string>;
  maxCallSec: number;
  maxConcurrentCalls: number;
  idleTimeoutSec: number;
  retentionDays: number;
  whatsappWebhook?: {
    appSecret: string;
    verifyToken: string;
  };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvironmentSchema.safeParse(env);

  if (!parsed.success) {
    // Lists variable names only, never their values.
    const description = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid API environment configuration: ${description}`);
  }

  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    // Render and similar hosts inject PORT. API_PORT remains available for
    // local development and explicit overrides outside managed hosting.
    port: e.PORT ?? e.API_PORT ?? 3000,
    trustProxyHops: e.API_TRUST_PROXY_HOPS,
    corsAllowedOrigins: e.CORS_ALLOWED_ORIGINS,
    logLevel: e.LOG_LEVEL,
    mongoUri: e.MONGODB_URI,
    tutWithUs: {
      baseUrl: e.TUTWITHUS_API_URL,
      timeoutMs: e.TUTWITHUS_TIMEOUT_MS,
      authLoginPath: e.TUTWITHUS_AUTH_LOGIN_PATH,
      ...(e.TUTWITHUS_LOOKUP_PATH
        ? { lookupPath: e.TUTWITHUS_LOOKUP_PATH }
        : {}),
    },
    ...(e.REDIS_URL ? { redisUrl: e.REDIS_URL } : {}),
    workerConcurrency: e.WORKER_CONCURRENCY,
    adminJwtSecret: e.ADMIN_JWT_SECRET ?? randomBytes(32).toString('base64url'),
    adminJwtSecretIsEphemeral: e.ADMIN_JWT_SECRET === undefined,
    adminJwtTtlDays: e.ADMIN_JWT_TTL_DAYS,
    openai: {
      apiKey: e.OPENAI_API_KEY,
      realtimeModel: e.OPENAI_REALTIME_MODEL,
      embeddingModel: e.OPENAI_EMBEDDING_MODEL,
      turnDetection:
        e.VOICE_TURN_DETECTION === 'semantic_vad'
          ? {
              type: 'semantic_vad',
              eagerness: e.VOICE_VAD_EAGERNESS,
              create_response: false,
            }
          : {
              type: 'server_vad',
              threshold: e.VOICE_VAD_THRESHOLD,
              silence_duration_ms: e.VOICE_SILENCE_MS,
              prefix_padding_ms: DEFAULT_SERVER_VAD.prefix_padding_ms,
              create_response: false,
            },
    },
    elevenLabs: {
      apiKey: e.ELEVENLABS_API_KEY,
      saudiArabicVoiceId: e.ELEVENLABS_SAUDI_ARABIC_VOICE_ID,
      modelId: e.ELEVENLABS_MODEL_ID,
    },
    consentVersion: e.CONSENT_VERSION,
    consentText: {
      'ar-SA': e.CONSENT_TEXT_AR,
      en: e.CONSENT_TEXT_EN,
      fr: e.CONSENT_TEXT_FR,
    },
    maxCallSec: e.MAX_CALL_SEC,
    maxConcurrentCalls: e.MAX_CONCURRENT_CALLS,
    idleTimeoutSec: e.IDLE_TIMEOUT_SEC,
    retentionDays: e.RETENTION_DAYS,
    ...(e.WHATSAPP_APP_SECRET && e.WHATSAPP_WEBHOOK_VERIFY_TOKEN
      ? {
          whatsappWebhook: {
            appSecret: e.WHATSAPP_APP_SECRET,
            verifyToken: e.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
          },
        }
      : {}),
  };
}

export const supportedLocales = LocaleSchema.options;
