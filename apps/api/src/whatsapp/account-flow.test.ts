import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../lib/logger.js';
import { ToolGateway, type ToolCall } from '../core/tools/tool-gateway.js';
import {
  defineTool,
  type ToolRunContext,
} from '../core/tools/tool-registry.js';
import {
  accountMessages,
  createVerifyMemberIdTool,
  type WhatsAppMemberDirectory,
} from './account-flow.js';

function setup() {
  const directory = {
    loginMember: vi.fn<WhatsAppMemberDirectory['loginMember']>(),
  };
  const action = vi.fn(async (_args: object, context: ToolRunContext) => ({
    output: { status: 'done', hasAccessToken: !!context.serverAccessToken },
  }));
  const publicAction = vi.fn(
    async (_args: object, context: ToolRunContext) => ({
      output: {
        status: 'public_answer',
        hasAccessToken: !!context.serverAccessToken,
      },
    }),
  );
  const record = vi.fn().mockResolvedValue(undefined);
  const gateway = new ToolGateway(
    [
      createVerifyMemberIdTool({
        registrationStatus: 'registered',
        phone: '966500000001',
        directory,
        locale: 'en',
      }),
      defineTool({
        name: 'private_action',
        description: 'Test account action',
        access: { kind: 'public' },
        parameters: z.object({}),
        requiresVerifiedCustomer: true,
        maxCallsPerSession: 10,
        execute: action,
      }),
      defineTool({
        name: 'public_knowledge',
        description: 'Test public question',
        access: { kind: 'public' },
        parameters: z.object({}),
        maxCallsPerSession: 10,
        execute: publicAction,
      }),
    ],
    { record },
    createLogger({ service: 'test', level: 'silent' }),
  );
  const call: ToolCall = {
    context: {
      sessionId: 'test-call',
      locale: 'en',
      retrieval: { topK: 5, minScore: 0.7 },
      responseExpectation: '',
      accountAccessHint: accountMessages.en.askId,
      actionUnavailableMessage: accountMessages.en.unavailable,
    },
    callCounts: new Map(),
    recordExpiresAt: new Date(),
    customerVerified: false,
  };
  const run = async (name: string, args: unknown = {}) =>
    JSON.parse(
      (await gateway.execute(call, name, JSON.stringify(args))).output,
    );
  return { directory, action, publicAction, record, call, run };
}

describe('WhatsApp member login authorization', () => {
  it('keeps account actions gated while public knowledge remains available', async () => {
    const s = setup();
    expect((await s.run('private_action')).reason).toBe('ACCOUNT_NOT_VERIFIED');
    expect(s.action).not.toHaveBeenCalled();
    expect((await s.run('public_knowledge')).status).toBe('public_answer');
  });

  it('logs in with the trusted phone without plus and preserves member ID zeros', async () => {
    const s = setup();
    s.directory.loginMember.mockResolvedValue({
      status: 'verified',
      accessToken: 'secret-access-token',
      role: 'tutor',
    });

    const result = await s.run('verify_member_id', { memberId: '0012Ab' });
    expect(result.status).toBe('verified');
    expect(result.instruction).toContain(
      accountMessages.en.verifiedInstruction,
    );
    expect(result.instruction).toContain('includeCourseAccessLevels=true');
    expect(result.instruction).toContain('get_my_bootcamps');
    expect(result.instruction).toContain('get_my_wallet');
    expect(result.instruction).toContain(
      'get_my_wallet. For bootcamp requests, call get_my_bootcamps.',
    );
    expect(result.instruction).toContain(
      'check_subject_eligibility once with the original course name',
    );
    expect(result.instruction).toContain(
      'do not call get_subjects or get_my_wallet separately for that flow',
    );
    expect(result.instruction).toContain(
      'For a general question about which courses the caller’s wallet gives access to without a named course',
    );
    expect(result.instruction).toContain('positiveCreditLevels');
    expect(result.instruction).toContain(
      'positive-credit levels do not confirm eligibility for every individual course',
    );
    expect(result.instruction).toContain(
      'report each returned bundleName and its credits',
    );
    expect(result.instruction).toContain(
      'Do not speak a separate verification confirmation',
    );
    expect(result.instruction).toContain(
      'For a pending request about the tutor’s own availability, call get_my_tutor_availability as soon as it is listed',
    );
    expect(result.instruction).toContain(
      'filter the returned entries to that period using today’s date and the call time zone',
    );
    expect(s.directory.loginMember).toHaveBeenCalledWith({
      phone: '966500000001',
      memberId: '0012Ab',
    });
    expect(s.call.customerVerified).toBe(true);
    expect(s.call.serverAccessToken).toBe('secret-access-token');
    expect(s.call.serverRole).toBe('tutor');
    expect((await s.run('private_action')).hasAccessToken).toBe(true);
    expect(s.action.mock.calls[0][1].serverAccessToken).toBe(
      'secret-access-token',
    );
    expect(s.action.mock.calls[0][1].serverRole).toBe('tutor');
    expect((await s.run('public_knowledge')).hasAccessToken).toBe(false);
    expect(s.publicAction.mock.calls[0][1].serverAccessToken).toBeUndefined();
    expect(JSON.stringify(s.record.mock.calls)).not.toContain(
      'secret-access-token',
    );
    expect(JSON.stringify(s.record.mock.calls)).not.toContain('0012Ab');
    expect(JSON.stringify(result)).not.toContain('secret-access-token');
  });

  it.each([
    [
      'en',
      'For eligibility or booking of one named course, call check_subject_eligibility once',
      'do not call get_subjects or get_my_wallet separately for that flow',
    ],
    [
      'fr',
      'Pour l’éligibilité ou la réservation d’un cours précis, appelez une seule fois check_subject_eligibility',
      'n’appelez pas séparément get_subjects ni get_my_wallet pour ce parcours',
    ],
    [
      'ar-SA',
      'لأهلية دورة محددة أو حجزها، استدعِ check_subject_eligibility مرة واحدة',
      'ولا تستدعِ get_subjects أو get_my_wallet منفصلتين لهذا المسار',
    ],
  ] as const)(
    'routes verified named-course requests to the combined eligibility tool in %s',
    (locale, combinedLookup, noSeparateLookups) => {
      const instruction = accountMessages[locale].verifiedInstruction;

      expect(instruction).toContain(combinedLookup);
      expect(instruction).toContain(noSeparateLookups);
    },
  );

  it.each([
    ['en', 'For a general question about which courses the caller’s wallet'],
    ['fr', 'Pour une question générale, sans cours nommé'],
    ['ar-SA', 'إذا سأل المتصل بشكل عام عن الدورات التي تتيحها محفظته'],
  ] as const)(
    'routes general wallet-course-access questions through the wallet in %s',
    (locale, route) => {
      const instruction = accountMessages[locale].verifiedInstruction;

      expect(instruction).toContain(route);
      expect(instruction).toContain('positiveCreditLevels');
      expect(instruction).toContain('check_subject_eligibility');
    },
  );

  it('says the member ID may be invalid after a rejected login', async () => {
    const s = setup();
    s.directory.loginMember.mockResolvedValue({ status: 'not_verified' });

    const result = await s.run('verify_member_id', { memberId: 'wrong' });
    expect(result.instruction).toBe(accountMessages.en.mismatch);
    expect(s.call.customerVerified).toBe(false);
    expect(s.call.serverAccessToken).toBeUndefined();
    expect((await s.run('private_action')).reason).toBe('ACCOUNT_NOT_VERIFIED');
    expect((await s.run('public_knowledge')).status).toBe('public_answer');
  });

  it('keeps account actions locked when login is unavailable', async () => {
    const s = setup();
    s.directory.loginMember.mockResolvedValue({ status: 'unavailable' });

    const result = await s.run('verify_member_id', { memberId: '001' });
    expect(result.instruction).toBe(accountMessages.en.unavailable);
    expect((await s.run('private_action')).reason).toBe('ACCOUNT_NOT_VERIFIED');
    expect((await s.run('public_knowledge')).status).toBe('public_answer');
  });

  it('does not attempt login without a trusted caller phone', async () => {
    const directory = {
      loginMember: vi.fn<WhatsAppMemberDirectory['loginMember']>(),
    };
    const tool = createVerifyMemberIdTool({
      registrationStatus: 'registered',
      phone: undefined,
      directory,
      locale: 'en',
    });

    const result = await tool.invoke(
      { memberId: '001' },
      {
        sessionId: 'test-call',
        locale: 'en',
        retrieval: { topK: 5, minScore: 0.7 },
        responseExpectation: '',
        callsMade: 0,
      },
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.outcome.customerVerified).toBe(false);
      expect(result.outcome.output).toEqual({
        status: 'unavailable',
        instruction: accountMessages.en.unavailable,
      });
    }
    expect(directory.loginMember).not.toHaveBeenCalled();
  });

  it('clears the token when a later verification fails', async () => {
    const s = setup();
    s.directory.loginMember
      .mockResolvedValueOnce({
        status: 'verified',
        accessToken: 'secret-access-token',
        role: 'tutor',
      })
      .mockResolvedValue({ status: 'not_verified' });

    await s.run('verify_member_id', { memberId: 'valid' });
    expect(s.call.customerVerified).toBe(true);
    await s.run('verify_member_id', { memberId: 'wrong' });

    expect(s.call.customerVerified).toBe(false);
    expect(s.call.serverAccessToken).toBeUndefined();
    expect((await s.run('private_action')).reason).toBe('ACCOUNT_NOT_VERIFIED');
  });

  it('limits authentication attempts and handles backend failures', async () => {
    const s = setup();
    s.directory.loginMember
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ status: 'not_verified' });

    const failed = await s.run('verify_member_id', { memberId: '001' });
    expect(failed.instruction).toBe(accountMessages.en.unavailable);
    await s.run('verify_member_id', { memberId: '001' });
    await s.run('verify_member_id', { memberId: '001' });
    expect((await s.run('verify_member_id', { memberId: '001' })).reason).toBe(
      'TOOL_LIMIT',
    );
    expect(s.directory.loginMember).toHaveBeenCalledTimes(3);
  });
});
