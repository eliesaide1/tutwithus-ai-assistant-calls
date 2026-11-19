import { describe, expect, it, vi } from 'vitest';
import type { EscalationRepository } from './escalation.repository.js';
import { EscalationService } from './escalation.service.js';

function createRepository(): EscalationRepository {
  return {
    createEscalation: vi.fn(async () => undefined),
    listEscalations: vi.fn(async () => []),
    findEscalation: vi.fn(async () => null),
    updateEscalation: vi.fn(async () => true),
  };
}

describe('EscalationService.createFromVoiceSession', () => {
  it('creates a consented ticket using the verified session contact', async () => {
    const repository = createRepository();
    const resolveEscalationContact = vi.fn(async () => ({
      verified: true,
      contactPhone: '+966500000001',
    }));
    const service = new EscalationService(repository, resolveEscalationContact);

    const result = await service.createFromVoiceSession({
      sessionId: 'session-1',
      reason: 'safety',
      summary: 'Caller needs a team member to review a sensitive concern.',
      contactConsent: true,
    });

    expect(result).toMatchObject({ priority: 'urgent' });
    expect(result.ticketRef).toMatch(/^ESC-[A-F0-9]{10}$/);
    expect(resolveEscalationContact).toHaveBeenCalledWith(
      'session-1',
      expect.any(Date),
    );
    expect(repository.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        reason: 'safety',
        status: 'open',
        contactConsent: true,
        contact: { phone: '+966500000001' },
      }),
    );
  });

  it('creates public tickets with the callback phone resolved from the active call', async () => {
    const repository = createRepository();
    const service = new EscalationService(repository, async () => ({
      verified: false,
      contactPhone: '+1 (555) 555-1212',
    }));

    await service.createFromVoiceSession({
      sessionId: 'session-1',
      reason: 'user_requested',
      summary: 'Caller needs help creating an account.',
      contactConsent: true,
    });

    expect(repository.createEscalation).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        contactConsent: true,
        contact: { phone: '+15555551212' },
      }),
    );
  });

  it('does not create a public ticket when the active call has no valid callback phone', async () => {
    const repository = createRepository();
    const resolveContact = vi
      .fn()
      .mockResolvedValueOnce({ verified: false })
      .mockResolvedValueOnce({ verified: false, contactPhone: 'not a number' });
    const service = new EscalationService(repository, resolveContact);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        service.createFromVoiceSession({
          sessionId: 'session-1',
          reason: 'complaint',
          summary: 'Caller requests follow-up.',
          contactConsent: true,
        }),
      ).rejects.toMatchObject({ code: 'ESCALATION_CONTACT_UNAVAILABLE' });
    }
    expect(repository.createEscalation).not.toHaveBeenCalled();
  });

  it('does not create a ticket when verification is unavailable or a verified contact is missing', async () => {
    const repository = createRepository();
    const missingPhone = new EscalationService(repository, async () => ({
      verified: true,
    }));

    await expect(
      missingPhone.createFromVoiceSession({
        sessionId: 'session-1',
        reason: 'complaint',
        summary: 'Caller requests follow-up.',
        contactConsent: true,
      }),
    ).rejects.toMatchObject({ code: 'ESCALATION_CONTACT_UNAVAILABLE' });
    expect(repository.createEscalation).not.toHaveBeenCalled();

    const unconfigured = new EscalationService(repository);
    await expect(
      unconfigured.createFromVoiceSession({
        sessionId: 'session-1',
        reason: 'complaint',
        summary: 'Caller requests follow-up.',
        contactConsent: true,
      }),
    ).rejects.toMatchObject({
      code: 'ESCALATION_VERIFICATION_UNAVAILABLE',
    });
    expect(repository.createEscalation).not.toHaveBeenCalled();
  });
});

describe('EscalationService.updateEscalation', () => {
  const resolvedEscalation = {
    id: '0123456789abcdef01234567',
    sessionId: 'session-1',
    ticketRef: 'ESC-CLOSED',
    reason: 'user_requested' as const,
    summary: 'The caller was contacted by the team.',
    priority: 'normal' as const,
    status: 'resolved' as const,
    contactConsent: true,
    assigneeId: 'previous-agent',
    notes: [],
    slaDueAt: new Date('2026-11-10T14:00:00.000Z'),
    createdAt: new Date('2026-11-09T14:00:00.000Z'),
    updatedAt: new Date('2026-11-09T14:00:00.000Z'),
  };

  it('lets an administrator reopen a closed ticket and clears its old assignee', async () => {
    const repository = createRepository();
    vi.mocked(repository.findEscalation).mockResolvedValue(resolvedEscalation);
    const service = new EscalationService(repository);

    await expect(
      service.updateEscalation(
        { id: 'admin-1', role: 'admin' },
        resolvedEscalation.id,
        { action: 'reopen' },
      ),
    ).resolves.toMatchObject({ status: 'open', statusChanged: true });

    expect(repository.updateEscalation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: resolvedEscalation.id,
        expectedStatus: 'resolved',
        status: 'open',
        assigneeId: null,
      }),
    );
  });

  it('does not let an agent reopen a closed ticket', async () => {
    const repository = createRepository();
    vi.mocked(repository.findEscalation).mockResolvedValue(resolvedEscalation);
    const service = new EscalationService(repository);

    await expect(
      service.updateEscalation(
        { id: 'agent-1', role: 'agent' },
        resolvedEscalation.id,
        { action: 'reopen' },
      ),
    ).rejects.toMatchObject({ code: 'ESCALATION_TRANSITION_INVALID' });

    expect(repository.updateEscalation).not.toHaveBeenCalled();
  });
});
