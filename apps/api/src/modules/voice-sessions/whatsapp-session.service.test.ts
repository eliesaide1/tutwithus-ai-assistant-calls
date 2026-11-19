import { describe, expect, it, vi } from 'vitest';
import { WhatsAppSessionService } from './whatsapp-session.service.js';
import type { VoiceSessionRepository } from './voice-session.repository.js';

function createStore() {
  return {
    create: vi.fn<VoiceSessionRepository['create']>().mockResolvedValue(),
    endCall: vi.fn<VoiceSessionRepository['endCall']>().mockResolvedValue(),
    recordCallOutcome: vi
      .fn<VoiceSessionRepository['recordCallOutcome']>()
      .mockResolvedValue(),
    markCustomerVerified: vi
      .fn<VoiceSessionRepository['markCustomerVerified']>()
      .mockResolvedValue(),
  };
}

function createService(store = createStore()) {
  return {
    store,
    service: new WhatsAppSessionService(store, {
      callerHashSecret: 'a-long-test-secret-value',
      retentionDays: 30,
    }),
  };
}

describe('WhatsAppSessionService', () => {
  it('stores a started whatsapp record with no transcript and no consent', async () => {
    const { service, store } = createService();
    const now = new Date('2026-11-05T10:00:00Z');

    const handle = await service.begin({
      locale: 'ar-SA',
      callerNumber: '+966500000001',
      maxCallSec: 300,
      now,
    });

    const record = store.create.mock.calls[0]![0];
    expect(record).toMatchObject({
      sessionId: handle.sessionId,
      channel: 'whatsapp',
      locale: 'ar-SA',
      consentAccepted: false,
      startedAt: now,
      transcript: [],
      maxDurationSec: 300,
    });
    expect(record.callExpiresAt).toEqual(new Date('2026-11-05T10:05:00Z'));
    expect(record.expiresAt).toEqual(new Date('2026-12-05T10:00:00Z'));
    expect(handle.expiresAt).toEqual(record.expiresAt);
  });

  it('never stores the caller number, only a keyed hash', async () => {
    const { service, store } = createService();

    await service.begin({
      locale: 'en',
      callerNumber: '+966500000001',
      maxCallSec: 300,
    });

    const record = store.create.mock.calls[0]![0];
    expect(JSON.stringify(record)).not.toContain('500000001');
    expect(record.callerHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores the Meta call ID for webhook correlation when the SIP header is present', async () => {
    const { service, store } = createService();
    const metaCallId = 'wacid.ABGGFjFVU2AfAgo6V-Hc5eCgK5Gh';

    await service.begin({
      locale: 'en',
      metaCallId,
      maxCallSec: 60,
    });

    expect(store.create.mock.calls[0]![0].metaCallId).toBe(metaCallId);
  });

  it('gives the same hash to the same caller written two ways', async () => {
    const { service, store } = createService();

    await service.begin({
      locale: 'en',
      callerNumber: '+966 50 000 0001',
      maxCallSec: 60,
    });
    await service.begin({
      locale: 'en',
      callerNumber: '0500000001',
      maxCallSec: 60,
    });

    expect(store.create.mock.calls[0]![0].callerHash).toBe(
      store.create.mock.calls[1]![0].callerHash,
    );
  });

  it('gives different hashes to callers in different countries', async () => {
    const { service, store } = createService();

    await service.begin({
      locale: 'en',
      callerNumber: '+966500000001',
      maxCallSec: 60,
    });
    await service.begin({
      locale: 'en',
      callerNumber: '+971500000001',
      maxCallSec: 60,
    });

    expect(store.create.mock.calls[0]![0].callerHash).not.toBe(
      store.create.mock.calls[1]![0].callerHash,
    );
  });

  it('uses a different hash when the secret changes', async () => {
    const first = createService();
    const second = createService();
    const other = new WhatsAppSessionService(second.store, {
      callerHashSecret: 'another-long-test-secret',
      retentionDays: 30,
    });

    await first.service.begin({
      locale: 'en',
      callerNumber: '+966500000001',
      maxCallSec: 60,
    });
    await other.begin({
      locale: 'en',
      callerNumber: '+966500000001',
      maxCallSec: 60,
    });

    expect(first.store.create.mock.calls[0]![0].callerHash).not.toBe(
      second.store.create.mock.calls[0]![0].callerHash,
    );
  });

  it('omits the hash when the caller number is not trusted', async () => {
    const { service, store } = createService();

    await service.begin({ locale: 'en', maxCallSec: 60 });

    expect(store.create.mock.calls[0]![0]).not.toHaveProperty('callerHash');
  });

  it('ends the record with the same session token hash', async () => {
    const { service, store } = createService();
    const handle = await service.begin({ locale: 'en', maxCallSec: 60 });

    await service.end(handle, { reason: 'idle_timeout' });

    expect(store.endCall).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: handle.sessionId,
        sessionTokenHash: handle.sessionTokenHash,
        reason: 'idle_timeout',
      }),
    );
    expect(store.recordCallOutcome).not.toHaveBeenCalled();
  });

  it('saves flags when the call ends with any', async () => {
    const { service, store } = createService();
    const handle = await service.begin({ locale: 'en', maxCallSec: 60 });

    await service.end(handle, { reason: 'error', flags: ['agent_error'] });

    expect(store.recordCallOutcome).toHaveBeenCalledWith({
      sessionId: handle.sessionId,
      sessionTokenHash: handle.sessionTokenHash,
      outcome: { flags: ['agent_error'] },
    });
  });

  it('marks the customer as verified by caller ID', async () => {
    const { service, store } = createService();
    const handle = await service.begin({
      locale: 'en',
      callerNumber: '+966500000001',
      maxCallSec: 60,
    });

    await service.markCustomerVerified(handle, 'customer-1');

    expect(store.markCustomerVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: handle.sessionId,
        customerId: 'customer-1',
        via: 'caller_id',
        contactPhone: '+966500000001',
      }),
    );
  });
});
