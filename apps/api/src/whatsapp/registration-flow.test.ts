import { describe, expect, it, vi } from 'vitest';
import {
  lookupWhatsAppRegistration,
  createVerifyMemberIdTool,
  registrationMessages,
  accountMessages,
} from './account-flow.js';
import { describeWhatsAppAccountPolicy } from './caller-account.js';

const context = {
  sessionId: 'call',
  locale: 'en' as const,
  callsMade: 0,
  retrieval: { topK: 3, minScore: 0.5 },
  responseExpectation: '',
};
describe('WhatsApp registration-first flow', () => {
  it.each(['registered', 'not_registered', 'unavailable'] as const)(
    'preserves the initial lookup outcome: %s',
    async (status) => {
      const lookup = vi.fn(async () => ({ status }));
      expect(await lookupWhatsAppRegistration({ lookup }, '+96170123456')).toBe(
        status,
      );
      expect(lookup).toHaveBeenCalledWith({ phone: '+96170123456' });
    },
  );
  it('treats missing phone and backend errors as unavailable, never unregistered', async () => {
    const lookup = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await lookupWhatsAppRegistration({ lookup }, undefined)).toBe(
      'unavailable',
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(await lookupWhatsAppRegistration({ lookup }, '+96170123456')).toBe(
      'unavailable',
    );
  });
  it.each(['not_registered', 'unavailable'] as const)(
    'blocks ID login for %s even if the tool is called directly',
    async (registrationStatus) => {
      const loginMember = vi.fn();
      const tool = createVerifyMemberIdTool({
        directory: { loginMember },
        phone: '96170123456',
        locale: 'en',
        registrationStatus,
      });
      const result = await tool.invoke({ memberId: '12345' }, context);
      expect(result).toMatchObject({
        kind: 'ok',
        outcome: {
          customerVerified: false,
          output: { status: registrationStatus },
        },
      });
      expect(loginMember).not.toHaveBeenCalled();
    },
  );
  it.each(['en', 'fr', 'ar-SA'] as const)(
    'distinguishes registration failure from an ID mismatch in %s',
    (locale) => {
      const policy = describeWhatsAppAccountPolicy(
        locale,
        false,
        'not_registered',
      );
      expect(policy).toContain(registrationMessages[locale]);
      expect(policy).toContain('Do not request a member ID');
      expect(policy).toContain(
        'Public knowledge, public bundle recommendations',
      );
      expect(policy).not.toContain(accountMessages[locale].mismatch);
      expect(accountMessages[locale].verifiedInstruction).toContain(
        'includeCourseAccessLevels=true',
      );
    },
  );
});
