import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('WhatsApp worker environment configuration', () => {
  it('keeps WhatsApp calling disabled by default', () => {
    const config = loadConfig({ NODE_ENV: 'test' });

    expect(config.whatsappCallingEnabled).toBe(false);
    expect(config.whatsappDefaultLocale).toBe('ar-SA');
  });

  it('requires real LiveKit, OpenAI, and database configuration when enabled', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        WHATSAPP_CALLING_ENABLED: 'true',
      }),
    ).toThrow('Invalid WhatsApp worker environment configuration');
  });

  it('rejects placeholder LiveKit credentials when calling is enabled', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        WHATSAPP_CALLING_ENABLED: 'true',
        MONGODB_URI: 'mongodb://localhost/test',
        OPENAI_API_KEY: 'test-key',
        ELEVENLABS_API_KEY: 'test-elevenlabs-key',
        ELEVENLABS_SAUDI_ARABIC_VOICE_ID: 'saudi-voice',
        WHATSAPP_LIVEKIT_SIP_TRUNK_ID: 'trunk-id',
        LIVEKIT_URL: 'wss://livekit.example.com',
        LIVEKIT_API_KEY: 'replace-with-livekit-api-key',
        LIVEKIT_API_SECRET: 'replace-with-livekit-api-secret',
        CALLER_HASH_SECRET: 'a-long-test-secret-value',
      }),
    ).toThrow('Invalid WhatsApp worker environment configuration');
  });

  it('accepts a fully configured WhatsApp SIP agent', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      WHATSAPP_CALLING_ENABLED: 'true',
      MONGODB_URI: 'mongodb://localhost/test',
      OPENAI_API_KEY: 'test-key',
      ELEVENLABS_API_KEY: 'test-elevenlabs-key',
      ELEVENLABS_SAUDI_ARABIC_VOICE_ID: 'saudi-voice',
      WHATSAPP_LIVEKIT_SIP_TRUNK_ID: 'trunk-id',
      WHATSAPP_DEFAULT_LOCALE: 'en',
      LIVEKIT_URL: 'wss://livekit.example.com',
      LIVEKIT_API_KEY: 'livekit-key',
      LIVEKIT_API_SECRET: 'livekit-secret',
      CALLER_HASH_SECRET: 'a-long-test-secret-value',
    });

    expect(config.whatsappCallingEnabled).toBe(true);
    expect(config.whatsappSipTrunkId).toBe('trunk-id');
    expect(config.whatsappDefaultLocale).toBe('en');
    expect(config.livekit.url).toBe('wss://livekit.example.com');
    expect(config.callerHashSecret).toBe('a-long-test-secret-value');
  });

  it('uses the same call limits and retention defaults as the API', () => {
    const config = loadConfig({ NODE_ENV: 'test' });

    expect(config.maxCallSec).toBe(300);
    expect(config.idleTimeoutSec).toBe(90);
    expect(config.retentionDays).toBe(30);
  });

  it('reads the shared call limits from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      MAX_CALL_SEC: '120',
      IDLE_TIMEOUT_SEC: '15',
      RETENTION_DAYS: '7',
    });

    expect(config.maxCallSec).toBe(120);
    expect(config.idleTimeoutSec).toBe(15);
    expect(config.retentionDays).toBe(7);
  });

  it.each([
    ['missing', undefined],
    ['a placeholder', 'replace-with-a-random-secret'],
    ['too short', 'short'],
  ])(
    'refuses to enable calling when the caller hash secret is %s',
    (_name, secret) => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'test',
          WHATSAPP_CALLING_ENABLED: 'true',
          MONGODB_URI: 'mongodb://localhost/test',
          OPENAI_API_KEY: 'test-key',
          WHATSAPP_DEFAULT_LOCALE: 'en',
          WHATSAPP_LIVEKIT_SIP_TRUNK_ID: 'trunk-id',
          LIVEKIT_URL: 'wss://livekit.example.com',
          LIVEKIT_API_KEY: 'livekit-key',
          LIVEKIT_API_SECRET: 'livekit-secret',
          ...(secret === undefined ? {} : { CALLER_HASH_SECRET: secret }),
        }),
      ).toThrow('CALLER_HASH_SECRET');
    },
  );

  it('requires an ElevenLabs Saudi Arabic voice when Arabic calling is enabled', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        WHATSAPP_CALLING_ENABLED: 'true',
        MONGODB_URI: 'mongodb://localhost/test',
        OPENAI_API_KEY: 'test-key',
        WHATSAPP_LIVEKIT_SIP_TRUNK_ID: 'trunk-id',
        LIVEKIT_URL: 'wss://livekit.example.com',
        LIVEKIT_API_KEY: 'livekit-key',
        LIVEKIT_API_SECRET: 'livekit-secret',
        CALLER_HASH_SECRET: 'a-long-test-secret-value',
      }),
    ).toThrow('WHATSAPP_CALLING_ENABLED');
  });
});
