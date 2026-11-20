import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

const requiredEnvironment = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/tutwithus_test',
  CONSENT_TEXT_AR: 'test',
  CONSENT_TEXT_EN: 'test',
  CONSENT_TEXT_FR: 'test',
};

describe('API environment configuration', () => {
  it('uses the hosting PORT and keeps API_PORT as a local fallback', () => {
    expect(loadConfig(requiredEnvironment).port).toBe(3000);
    expect(loadConfig({ ...requiredEnvironment, API_PORT: '3100' }).port).toBe(
      3100,
    );
    expect(
      loadConfig({ ...requiredEnvironment, API_PORT: '3100', PORT: '10000' })
        .port,
    ).toBe(10000);
  });

  it('validates configurable turn detection without changing the defaults', () => {
    expect(loadConfig(requiredEnvironment).openai.turnDetection).toEqual({
      type: 'server_vad',
      threshold: 0.8,
      silence_duration_ms: 500,
      prefix_padding_ms: 300,
      create_response: false,
    });
    expect(
      loadConfig({
        ...requiredEnvironment,
        VOICE_TURN_DETECTION: 'semantic_vad',
        VOICE_VAD_EAGERNESS: 'low',
      }).openai.turnDetection,
    ).toEqual({
      type: 'semantic_vad',
      eagerness: 'low',
      create_response: false,
    });
    expect(() =>
      loadConfig({ ...requiredEnvironment, VOICE_VAD_THRESHOLD: '2' }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...requiredEnvironment, VOICE_SILENCE_MS: '0' }),
    ).toThrow();
  });
  it('defaults the admin JWT lifetime to one day', () => {
    expect(loadConfig(requiredEnvironment).adminJwtTtlDays).toBe(1);
  });

  it('loads Meta webhook credentials only when both values are configured', () => {
    expect(
      loadConfig({
        ...requiredEnvironment,
        WHATSAPP_APP_SECRET: 'meta-app-secret',
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'webhook-verify-token',
      }).whatsappWebhook,
    ).toEqual({
      appSecret: 'meta-app-secret',
      verifyToken: 'webhook-verify-token',
    });

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        WHATSAPP_APP_SECRET: 'meta-app-secret',
      }),
    ).toThrow('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  });

  it('parses exact CORS origins from a comma-separated environment value', () => {
    expect(
      loadConfig({
        ...requiredEnvironment,
        CORS_ALLOWED_ORIGINS:
          'https://len-strict-covering-techniques.trycloudflare.com, https://admin.example.com',
      }).corsAllowedOrigins,
    ).toEqual([
      'https://len-strict-covering-techniques.trycloudflare.com',
      'https://admin.example.com',
    ]);
  });

  it('rejects CORS URLs that are not origins', () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        CORS_ALLOWED_ORIGINS: 'https://admin.example.com/admin',
      }),
    ).toThrow('Invalid API environment configuration');
  });

  it('accepts a configured admin JWT lifetime', () => {
    expect(
      loadConfig({ ...requiredEnvironment, ADMIN_JWT_TTL_DAYS: '7' })
        .adminJwtTtlDays,
    ).toBe(7);
  });

  it('defaults the call limits', () => {
    const config = loadConfig(requiredEnvironment);

    expect(config.maxConcurrentCalls).toBe(20);
    expect(config.idleTimeoutSec).toBe(90);
  });

  it('accepts configured call limits and rejects unusable ones', () => {
    const config = loadConfig({
      ...requiredEnvironment,
      MAX_CONCURRENT_CALLS: '5',
      IDLE_TIMEOUT_SEC: '45',
    });
    expect(config.maxConcurrentCalls).toBe(5);
    expect(config.idleTimeoutSec).toBe(45);

    for (const bad of [
      { MAX_CONCURRENT_CALLS: '0' },
      { IDLE_TIMEOUT_SEC: '2' },
      { IDLE_TIMEOUT_SEC: '601' },
    ]) {
      expect(() => loadConfig({ ...requiredEnvironment, ...bad })).toThrow(
        'Invalid API environment configuration',
      );
    }
  });

  it('defaults the external TutWithUs service separately from MongoDB', () => {
    expect(loadConfig(requiredEnvironment).tutWithUs!.baseUrl).toBe(
      'https://api.tutwithus.com',
    );
    expect(
      loadConfig({
        ...requiredEnvironment,
        TUTWITHUS_API_URL: 'https://staging-api.tutwithus.com',
      }).tutWithUs!.baseUrl,
    ).toBe('https://staging-api.tutwithus.com');
  });

  it('accepts a configured TutWithUs API URL', () => {
    expect(
      loadConfig({
        ...requiredEnvironment,
        TUTWITHUS_API_URL: 'https://api.example.com',
      }).tutWithUs!.baseUrl,
    ).toBe('https://api.example.com');
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        TUTWITHUS_API_URL: 'not-a-url',
      }),
    ).toThrow('Invalid API environment configuration');
  });

  it('rejects admin JWT lifetimes outside the supported range', () => {
    expect(() =>
      loadConfig({ ...requiredEnvironment, ADMIN_JWT_TTL_DAYS: '0' }),
    ).toThrow('Invalid API environment configuration');
    expect(() =>
      loadConfig({ ...requiredEnvironment, ADMIN_JWT_TTL_DAYS: '366' }),
    ).toThrow('Invalid API environment configuration');
  });
});
