import { describe, expect, it } from 'vitest';
import { EvalCaseSchema, type EvalCase } from './case-schema.js';
import { CANARY, runCase } from './conversation.js';
import { grade } from './grade.js';
import { loadCases } from './load-cases.js';
import { callTool, say, scriptedModel } from './testing.js';

function makeCase(overrides: Record<string, unknown> = {}): EvalCase {
  return EvalCaseSchema.parse({
    id: 'en-test-case',
    locale: 'en',
    category: 'in_scope',
    description: 'test',
    caller: 'unregistered',
    knowledge: [
      {
        sourceId: 'faq-hours',
        title: 'Hours',
        content: 'Lessons run Sunday to Thursday.',
      },
    ],
    turns: ['When are lessons?'],
    expect: {},
    ...overrides,
  });
}

const availabilityArgs = {
  levelId: '67000c1b946a639c101fc906',
  subjectId: '66faa9e27abf0bd6f0b0305c',
  tutorId: '67000c1b946a639c101fc908',
  fromDate: '2026-11-20',
  toDate: '2026-12-20',
  timeZone: 'Asia/Riyadh',
};
const bookingArgs = {
  levelId: '67000c1b946a639c101fc906',
  subjectId: '67000c1b946a639c101fc907',
  tutorId: '67000c1b946a639c101fc908',
  date: '2026-11-25',
  timeFrom: '11:30',
  timeTo: '12:00',
  timeZone: 'Asia/Riyadh',
};
const escalateArgs = {
  reason: 'user_requested',
  summary: 'Wants to book a lesson.',
  contactConsent: true,
};

describe('runCase', () => {
  it('gives the model the real instructions, the secret to protect and the caller status', async () => {
    const model = scriptedModel([say('Hello.')]);

    await runCase(makeCase(), model);

    const system = model.requests[0]!.messages[0]!;
    expect(system.role).toBe('system');
    expect(system.content).toContain(CANARY);
    expect(system.content).toContain('search_knowledge');
    expect(system.content).toContain(
      'CALLER ACCOUNT STATUS: not registered or verified',
    );
  });

  it('tells the model member-ID verification may still be required', async () => {
    const model = scriptedModel([say('Hello.')]);

    await runCase(makeCase({ caller: 'registered' }), model);

    expect(model.requests[0]!.messages[0]!.content).toContain(
      'CALLER ACCOUNT STATUS: registered with TutWithUs',
    );
    expect(model.requests[0]!.messages[0]!.content).toContain(
      'Member-ID verification may still be required',
    );
  });

  it('verifies a member ID before returning protected bootcamp data', async () => {
    const model = scriptedModel([
      callTool('verify_member_id', { memberId: '1234567' }, 'verify'),
      callTool('get_my_bootcamps', {}, 'bootcamps'),
      say('You have React and Node Fullstack.'),
    ]);

    await runCase(
      makeCase({
        caller: 'registered',
        turns: ['Show me my bootcamps. My member ID is 1234567.'],
      }),
      model,
    );

    const toolMessages = model.requests[2]!.messages.filter(
      (message) => message.role === 'tool',
    );
    expect(toolMessages[0]?.content).toContain('"status":"verified"');
    expect(toolMessages[1]?.content).toContain('React and Node Fullstack');
    expect(toolMessages[1]?.content).not.toContain('eval-token');
  });

  it('verifies a member ID before returning each wallet credit', async () => {
    const model = scriptedModel([
      callTool('verify_member_id', { memberId: '1234567' }, 'verify'),
      callTool('get_my_wallet', {}, 'wallet'),
      say('You have 3 credits in Software Engineering Program.'),
    ]);

    await runCase(
      makeCase({
        caller: 'registered',
        turns: ['Check my wallet. My member ID is 1234567.'],
      }),
      model,
    );

    const walletMessage = model.requests[2]!.messages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'wallet',
    );
    expect(walletMessage?.content).toContain(
      '"bundleName":"Software Engineering Program"',
    );
    expect(walletMessage?.content).toContain('"credits":3');
    expect(walletMessage?.content).not.toContain('Elementary');
    expect(walletMessage?.content).not.toContain('eval-token');
  });

  it('offers only the configured shared tools and omits unavailable actions', async () => {
    const model = scriptedModel([
      callTool('verify_member_id', { memberId: '1234567' }, 'verify'),
      say('Hello.'),
    ]);

    await runCase(makeCase({ caller: 'registered', tutors: [] }), model);

    expect(model.requests[0]!.tools.map((tool) => tool.name).sort()).toEqual([
      'end_call',
      'escalate_to_human',
      'get_booking_levels',
      'get_subjects',
      'request_member_id',
      'search_knowledge',
      'verify_member_id',
    ]);
    expect(model.requests[1]!.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'get_my_bootcamps',
        'get_my_wallet',
        'get_booking_levels',
        'get_booking_subjects',
        'find_booking_tutors',
        'check_tutor_availability',
        'book_course',
      ]),
    );
  });

  it('runs a search and records the citation', async () => {
    const model = scriptedModel([
      callTool('search_knowledge', { query: 'lesson days', language: 'en' }),
      say('Lessons run Sunday to Thursday.'),
    ]);

    const result = await runCase(makeCase(), model);

    expect(result.attempts).toEqual([
      { name: 'search_knowledge', decision: 'allowed', denyReason: undefined },
    ]);
    expect(result.citedSourceIds).toEqual(['faq-hours']);
    expect(result.replies).toEqual(['Lessons run Sunday to Thursday.']);
  });

  it('passes the search result back to the model as a tool message', async () => {
    const model = scriptedModel([
      callTool('search_knowledge', { query: 'lesson days', language: 'en' }),
      say('Done.'),
    ]);

    await runCase(makeCase(), model);

    const toolMessage = model.requests[1]!.messages.find(
      (message) => message.role === 'tool',
    );
    expect(toolMessage?.content).toContain('Sunday to Thursday');
  });

  it('passes the subject fixture back to the model as a tool message', async () => {
    const subjects = [
      { label: 'Mathematics', value: '67000c1b946a639c101fc906' },
      { label: 'Physics', value: '66faa9e27abf0bd6f0b0305c' },
    ];
    const model = scriptedModel([
      callTool('get_subjects', {}, 'subjects'),
      say('We offer Mathematics and Physics.'),
    ]);

    const result = await runCase(
      makeCase({ subjects, turns: ['Which courses do you offer?'] }),
      model,
    );

    expect(result.attempts[0]).toMatchObject({
      name: 'get_subjects',
      decision: 'allowed',
    });
    const toolMessage = model.requests[1]!.messages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'subjects',
    );
    if (!toolMessage || typeof toolMessage.content !== 'string') {
      throw new Error('Expected get_subjects tool result');
    }
    expect(JSON.parse(toolMessage.content)).toEqual({
      status: 'available',
      subjects,
    });
  });

  it('refuses a search written in the wrong language', async () => {
    const model = scriptedModel([
      callTool('search_knowledge', { query: 'jours', language: 'fr' }),
      say('Sorry.'),
    ]);

    const result = await runCase(makeCase(), model);

    expect(result.attempts[0]).toMatchObject({
      decision: 'denied',
      denyReason: 'LOCALE_MISMATCH',
    });
  });

  it('refuses protected account tools for an unverified caller', async () => {
    const model = scriptedModel([
      callTool('check_tutor_availability', availabilityArgs, 'a'),
      callTool(
        'find_booking_tutors',
        {
          levelId: availabilityArgs.levelId,
          subjectId: availabilityArgs.subjectId,
        },
        'b',
      ),
      callTool('get_my_bootcamps', {}, 'c'),
      callTool('get_my_wallet', {}, 'd'),
      callTool('book_course', bookingArgs, 'e'),
      say('Please register at tutwithus.com first.'),
    ]);

    const result = await runCase(
      makeCase({
        tutors: [],
        turns: [
          'Check tutors, show my bootcamps and wallet, and book a lesson.',
        ],
      }),
      model,
    );

    expect(
      result.attempts.map((attempt) => [
        attempt.name,
        attempt.decision,
        attempt.denyReason,
      ]),
    ).toEqual([
      ['check_tutor_availability', 'denied', 'ACCOUNT_NOT_VERIFIED'],
      ['find_booking_tutors', 'denied', 'ACCOUNT_NOT_VERIFIED'],
      ['get_my_bootcamps', 'denied', 'ACCOUNT_NOT_VERIFIED'],
      ['get_my_wallet', 'denied', 'ACCOUNT_NOT_VERIFIED'],
      ['book_course', 'denied', 'ACCOUNT_NOT_VERIFIED'],
    ]);
    expect(result.endedCall).toBe(false);
  });

  it('lets an unverified caller consent to a team handoff without exposing internal ticket data', async () => {
    const confirmation =
      'Your follow-up request has been recorded for our team.';
    const model = scriptedModel([
      callTool('escalate_to_human', escalateArgs),
      say(confirmation),
    ]);

    const result = await runCase(makeCase(), model);

    expect(result.attempts[0]).toMatchObject({
      name: 'escalate_to_human',
      decision: 'allowed',
    });
    const toolMessage = model.requests[1]!.messages.find(
      (message) => message.role === 'tool',
    );
    expect(toolMessage?.content).toContain('"status":"created"');
    expect(toolMessage?.content).not.toContain('ESC-EVAL');
    expect(model.requests[1]!.responseInstructions).toContain(confirmation);
  });

  it('returns the tutors from the platform to a verified caller', async () => {
    const model = scriptedModel([
      callTool('verify_member_id', { memberId: '1234567' }, 'verify'),
      callTool(
        'find_booking_tutors',
        {
          levelId: availabilityArgs.levelId,
          subjectId: availabilityArgs.subjectId,
        },
        'tutors',
      ),
      say('Sara is listed.'),
    ]);

    await runCase(
      makeCase({
        caller: 'registered',
        tutors: [
          {
            displayName: 'Sara Al-Harbi',
            courses: ['Mathematics'],
            slots: [
              {
                start: '2026-11-09T15:00:00+03:00',
                end: '2026-11-09T16:00:00+03:00',
              },
            ],
          },
        ],
      }),
      model,
    );

    const toolMessage = model.requests[2]!.messages.find(
      (message) => message.role === 'tool' && message.toolCallId === 'tutors',
    );
    expect(toolMessage?.content).toContain('Sara Al-Harbi');
  });

  it('does not advertise availability when no tutor source is configured', async () => {
    const model = scriptedModel([
      callTool('verify_member_id', { memberId: '1234567' }, 'verify'),
      say('Availability checks are unavailable right now.'),
    ]);

    await runCase(makeCase({ caller: 'registered' }), model);

    expect(model.requests[0]!.tools.map((tool) => tool.name)).not.toContain(
      'check_tutor_availability',
    );
    expect(model.requests[1]!.tools.map((tool) => tool.name)).not.toContain(
      'check_tutor_availability',
    );
  });

  it('stops the conversation when an unverified caller ends the call', async () => {
    const model = scriptedModel([
      callTool('end_call', {}),
      say('Goodbye.'),
      say('This should never be reached.'),
    ]);

    const result = await runCase(
      makeCase({
        turns: ['Bye.', 'Are you still there?'],
      }),
      model,
    );

    expect(result.endedCall).toBe(true);
    expect(result.replies).toEqual(['Goodbye.']);
  });

  it('runs each caller turn in order', async () => {
    const model = scriptedModel([say('First answer.'), say('Second answer.')]);

    const result = await runCase(makeCase({ turns: ['One?', 'Two?'] }), model);

    expect(result.replies).toEqual(['First answer.', 'Second answer.']);
    const users = model.requests[1]!.messages.filter(
      (message) => message.role === 'user',
    );
    expect(users.map((message) => message.content)).toEqual(['One?', 'Two?']);
  });

  it('gives up on a model that never stops calling tools', async () => {
    const model = scriptedModel([
      callTool('search_knowledge', { query: 'x', language: 'en' }),
    ]);

    const result = await runCase(makeCase(), model);

    expect(model.requests.length).toBeLessThanOrEqual(6);
    expect(result.replies).toEqual([]);
  });
});

describe('the server rules, on every unregistered golden case', () => {
  const unregistered = loadCases().filter(
    (testCase) => testCase.caller === 'unregistered',
  );

  it.each(unregistered.map((testCase) => [testCase.id, testCase] as const))(
    '%s: a model that tries every account tool still cannot run one',
    async (_id, testCase) => {
      const model = scriptedModel([
        callTool('check_tutor_availability', availabilityArgs, 'a'),
        callTool('get_my_bootcamps', {}, 'b'),
        callTool('get_my_wallet', {}, 'c'),
        callTool(
          'find_booking_tutors',
          {
            levelId: availabilityArgs.levelId,
            subjectId: availabilityArgs.subjectId,
          },
          'd',
        ),
        callTool('book_course', bookingArgs, 'e'),
        say('Please register at tutwithus.com first.'),
      ]);

      const result = await runCase(
        { ...testCase, tutors: testCase.tutors ?? [] },
        model,
      );

      expect(
        result.attempts.filter((attempt) => attempt.decision === 'allowed'),
      ).toEqual([]);
      expect(
        grade(testCase, result).filter(
          (failure) => failure.check === 'toolsNotExecuted',
        ),
      ).toEqual([]);
    },
  );
});
