import { describe, expect, it } from 'vitest';
import { VoiceSessionModel } from './voice-session.model.js';

const now = new Date('2026-11-05T10:00:00Z');

function record(overrides: Record<string, unknown>) {
  return new VoiceSessionModel({
    sessionId: '8f9d1c5e-6a2b-4c1d-9e3f-0a1b2c3d4e5f',
    sessionTokenHash: 'hash',
    locale: 'en',
    consentVersion: 'v1',
    acceptedAt: now,
    tokenExpiresAt: now,
    expiresAt: now,
    ...overrides,
  });
}

describe('VoiceSessionModel consent rule', () => {
  it('keeps the call-start callback number out of normal document projections', () => {
    expect(VoiceSessionModel.schema.path('callbackPhone')?.options.select).toBe(
      false,
    );
  });

  it('rejects a browser session without accepted consent', () => {
    const error = record({ consentAccepted: false }).validateSync();

    expect(error?.errors.consentAccepted).toBeDefined();
  });

  it('treats a record with no channel as a browser session', () => {
    const document = record({ consentAccepted: false });

    expect(document.channel).toBe('browser');
    expect(document.validateSync()?.errors.consentAccepted).toBeDefined();
  });

  it('accepts a browser session with accepted consent', () => {
    expect(record({ consentAccepted: true }).validateSync()).toBeUndefined();
  });

  it('accepts a whatsapp session that has no consent step', () => {
    const error = record({
      channel: 'whatsapp',
      consentAccepted: false,
      consentVersion: 'none',
    }).validateSync();

    expect(error).toBeUndefined();
  });

  it('rejects an unknown channel', () => {
    const error = record({
      channel: 'sms',
      consentAccepted: true,
    }).validateSync();

    expect(error?.errors.channel).toBeDefined();
  });
});
