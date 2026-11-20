import { z } from 'zod';

const optionalValue = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const EnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    MONGODB_URI: optionalValue,
    TUTWITHUS_API_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.url().default('https://api.tutwithus.com'),
    ),
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
    OPENAI_API_KEY: optionalValue,
    OPENAI_REALTIME_MODEL: z.string().min(1).default('gpt-realtime-2.1-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    WHATSAPP_CALLING_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    WHATSAPP_LIVEKIT_SIP_TRUNK_ID: optionalValue,
    WHATSAPP_DEFAULT_LOCALE: z.enum(['ar-SA', 'en', 'fr']).default('ar-SA'),
    LIVEKIT_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .url()
        .refine((value) => ['ws:', 'wss:'].includes(new URL(value).protocol))
        .optional(),
    ),
    LIVEKIT_API_KEY: optionalValue,
    LIVEKIT_API_SECRET: optionalValue,
    LIVEKIT_WHATSAPP_AGENT_NAME: z
      .string()
      .min(1)
      .default('tutwithus-whatsapp-agent'),
    // Same names and defaults as the API, so one .env governs both channels.
    MAX_CALL_SEC: z.coerce.number().int().positive().default(300),
    IDLE_TIMEOUT_SEC: z.coerce.number().int().min(5).max(600).default(90),
    RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    // Keys the hash of caller numbers stored on WhatsApp session records.
    CALLER_HASH_SECRET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(16).optional(),
    ),
  })
  .refine(
    (env) =>
      !env.WHATSAPP_CALLING_ENABLED ||
      (env.CALLER_HASH_SECRET !== undefined &&
        !env.CALLER_HASH_SECRET.startsWith('replace-with-')),
    {
      path: ['CALLER_HASH_SECRET'],
      message:
        'Required (at least 16 characters, not a placeholder) when WhatsApp calling is enabled.',
    },
  )
  .refine(
    (env) =>
      !env.WHATSAPP_CALLING_ENABLED ||
      (env.MONGODB_URI !== undefined &&
        env.OPENAI_API_KEY !== undefined &&
        env.WHATSAPP_LIVEKIT_SIP_TRUNK_ID !== undefined &&
        env.LIVEKIT_URL !== undefined &&
        env.LIVEKIT_API_KEY !== undefined &&
        env.LIVEKIT_API_SECRET !== undefined &&
        !env.LIVEKIT_URL.includes('replace-with-') &&
        !env.LIVEKIT_API_KEY.startsWith('replace-with-') &&
        !env.LIVEKIT_API_SECRET.startsWith('replace-with-') &&
        !env.WHATSAPP_LIVEKIT_SIP_TRUNK_ID.startsWith('replace-with-')),
    {
      path: ['WHATSAPP_CALLING_ENABLED'],
      message:
        'Requires MongoDB, OpenAI, and non-placeholder LiveKit credentials and SIP trunk ID.',
    },
  );

export type WhatsAppWorkerConfig = {
  nodeEnv: z.infer<typeof EnvironmentSchema>['NODE_ENV'];
  mongoUri: string | undefined;
  openaiApiKey: string | undefined;
  openaiRealtimeModel: string;
  openaiEmbeddingModel: string;
  tutWithUs: {
    baseUrl: string;
    timeoutMs: number;
    authLoginPath: string;
    lookupPath?: string;
  };
  maxCallSec: number;
  idleTimeoutSec: number;
  retentionDays: number;
  callerHashSecret: string | undefined;
  whatsappCallingEnabled: boolean;
  whatsappSipTrunkId: string | undefined;
  whatsappDefaultLocale: 'ar-SA' | 'en' | 'fr';
  livekit: {
    url: string | undefined;
    apiKey: string | undefined;
    apiSecret: string | undefined;
    whatsappAgentName: string;
  };
};

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): WhatsAppWorkerConfig {
  const parsed = EnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    const description = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `Invalid WhatsApp worker environment configuration: ${description}`,
    );
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    mongoUri: parsed.data.MONGODB_URI,
    openaiApiKey: parsed.data.OPENAI_API_KEY,
    openaiRealtimeModel: parsed.data.OPENAI_REALTIME_MODEL,
    openaiEmbeddingModel: parsed.data.OPENAI_EMBEDDING_MODEL,
    tutWithUs: {
      baseUrl: parsed.data.TUTWITHUS_API_URL,
      timeoutMs: parsed.data.TUTWITHUS_TIMEOUT_MS,
      authLoginPath: parsed.data.TUTWITHUS_AUTH_LOGIN_PATH,
      ...(parsed.data.TUTWITHUS_LOOKUP_PATH
        ? { lookupPath: parsed.data.TUTWITHUS_LOOKUP_PATH }
        : {}),
    },
    maxCallSec: parsed.data.MAX_CALL_SEC,
    idleTimeoutSec: parsed.data.IDLE_TIMEOUT_SEC,
    retentionDays: parsed.data.RETENTION_DAYS,
    callerHashSecret: parsed.data.CALLER_HASH_SECRET,
    whatsappCallingEnabled: parsed.data.WHATSAPP_CALLING_ENABLED,
    whatsappSipTrunkId: parsed.data.WHATSAPP_LIVEKIT_SIP_TRUNK_ID,
    whatsappDefaultLocale: parsed.data.WHATSAPP_DEFAULT_LOCALE,
    livekit: {
      url: parsed.data.LIVEKIT_URL,
      apiKey: parsed.data.LIVEKIT_API_KEY,
      apiSecret: parsed.data.LIVEKIT_API_SECRET,
      whatsappAgentName: parsed.data.LIVEKIT_WHATSAPP_AGENT_NAME,
    },
  };
}
