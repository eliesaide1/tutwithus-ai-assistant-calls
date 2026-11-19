import { describe, expect, it, vi } from 'vitest';
import type { VoiceSessionRecord } from './voice-session.repository.js';
import {
  createVerifiedVoiceContactResolver,
  createVoiceEscalationContactResolver,
} from './voice-session.service.js';

function createRecord(now: Date): VoiceSessionRecord {
  return {
    sessionId: 'session-1',
    locale: 'en',
    consentVersion: '2026-11-04.1',
    consentAccepted: true,
    transcript: [],
    sessionTokenHash: 'hash',
    acceptedAt: now,
    tokenExpiresAt: new Date(now.getTime() + 60_000),
    expiresAt: new Date(now.getTime() + 86_400_000),
    startedAt: now,
    verifiedCustomer: {
      customerId: 'customer-1',
      verifiedAt: now,
      via: 'form',
      contactPhone: '+966500000001',
    },
  };
}

describe('createVerifiedVoiceContactResolver', () => {
  it('returns contact information only for an active verified session', async () => {
    const now = new Date();
    const record = createRecord(now);
    const repository = {
      findBySessionId: vi.fn(async () => record),
    };
    const resolve = createVerifiedVoiceContactResolver(repository);

    await expect(resolve('session-1', now)).resolves.toEqual({
      contactPhone: '+966500000001',
    });
  });

  describe('createVoiceEscalationContactResolver', () => {
    it('returns the verified account phone for an active verified session', async () => {
      const now = new Date();
      const record = createRecord(now);
      const repository = {
        findBySessionId: vi.fn(async () => record),
      };
      const resolve = createVoiceEscalationContactResolver(repository);

      await expect(resolve('session-1', now)).resolves.toEqual({
        verified: true,
        contactPhone: '+966500000001',
      });
    });

    it('allows active unverified sessions and rejects inactive sessions', async () => {
      const now = new Date();
      const record = createRecord(now);
      record.verifiedCustomer = undefined;
      record.callbackPhone = '+1 (555) 555-1212';
      const repository = {
        findBySessionId: vi.fn(async () => record),
      };
      const resolve = createVoiceEscalationContactResolver(repository);

      await expect(resolve('session-1', now)).resolves.toEqual({
        verified: false,
        contactPhone: '+1 (555) 555-1212',
      });

      record.callExpiresAt = new Date(now.getTime() - 1);
      await expect(resolve('session-1', now)).rejects.toMatchObject({
        code: 'SESSION_ALREADY_USED',
      });
    });
  });

  it('rejects unverified and inactive sessions', async () => {
    const now = new Date();
    const unverified = createRecord(now);
    unverified.verifiedCustomer = undefined;
    const repository = {
      findBySessionId: vi.fn(async () => unverified),
    };
    const resolve = createVerifiedVoiceContactResolver(repository);

    await expect(resolve('session-1', now)).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_VERIFIED',
    });

    const ended = createRecord(now);
    ended.endedAt = now;
    repository.findBySessionId.mockResolvedValue(ended);
    await expect(resolve('session-1', now)).rejects.toMatchObject({
      code: 'SESSION_ALREADY_USED',
    });
  });
});
