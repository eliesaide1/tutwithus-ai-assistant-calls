import { createLogger } from '../../lib/logger.js';
import type { Locale } from '@tutwithus/contracts';
import type {
  BookingAvailabilityResult,
  BookingTutorsResult,
} from '../../external/tutwithus/booking.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBookCourseTool,
  createPrepareCourseBookingTool,
  createCheckSubjectEligibilityTool,
  createCheckTutorAvailabilityTool,
  createEndCallTool,
  createEscalateToHumanTool,
  createGetBookingLevelsTool,
  createGetBookingSubjectsTool,
  createFindBookingTutorsTool,
  createGetMyBootcampsTool,
  createGetMyTutorAvailabilityTool,
  createGetMyWalletTool,
  createGetSubjectsTool,
  createRequestMemberIdTool,
  createSearchKnowledgeTool,
  createVerifyMemberIdTool,
  createVoiceTools,
} from './handlers/voice-tools.js';
import {
  ToolGateway,
  type ToolCall,
  type ToolInvocationEntry,
} from './tool-gateway.js';

const logger = createLogger({ level: 'silent', service: 'tool-gateway-test' });

function confirmationTools() {
  return [
    createPrepareCourseBookingTool(),
    createCheckTutorAvailabilityTool({
      findBookingTutors: async () => ({
        status: 'available',
        tutors: [{ id: 'tutor-1', name: 'Taylor Tutor' }],
      }),
      getTutorBookingAvailability: async (_token, input) => ({
        status: 'available',
        slots: [
          { date: input.fromDate, timeFrom: '10:00', timeTo: '11:00' },
          { date: input.fromDate, timeFrom: '11:00', timeTo: '12:00' },
        ],
      }),
    }),
  ];
}
async function confirmBooking(
  gateway: ToolGateway,
  call: ToolCall,
  date: string,
  timeFrom = '10:00',
  timeTo = '11:00',
) {
  const selection = {
    levelId: 'level-1',
    subjectId: 'subject-1',
    tutorId: 'tutor-1',
    date,
    timeFrom,
    timeTo,
    timeZone: 'UTC',
    description: 'Help with backend routing and server development',
  };
  await gateway.execute(
    call,
    'check_tutor_availability',
    JSON.stringify({
      levelId: 'level-1',
      subjectId: 'subject-1',
      tutorPreference: 'specific',
      tutorId: 'tutor-1',
      preferredDays: [
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
        'Sunday',
      ],
      fromDate: date,
      toDate: date,
    }),
  );
  const prepared = await gateway.execute(
    call,
    'prepare_course_booking',
    JSON.stringify(selection),
  );
  expect(JSON.parse(prepared.output).status).toBe('awaiting_confirmation');
  gateway.observeCallerTranscript(call.context.sessionId, 'yes');
}

afterEach(() => {
  vi.useRealTimers();
});

it('rejects duplicate tool registrations instead of silently replacing one', () => {
  const tool = createPrepareCourseBookingTool();

  expect(
    () =>
      new ToolGateway([tool, tool], { record: async () => undefined }, logger),
  ).toThrow('Duplicate tool registration: prepare_course_booking');
});

it('does not advertise placeholder availability but retains account verification', () => {
  const t = createGateway();
  const getMyBootcamps = vi.fn(async () => ({
    status: 'unavailable' as const,
  }));
  const getMyWallet = vi.fn(async () => ({
    status: 'unavailable' as const,
  }));
  const getSubjects = vi.fn(async () => ({
    status: 'available' as const,
    subjects: [],
  }));
  const tools = createVoiceTools({
    retriever: t.retriever,
    escalations: t.escalations,
    accountActions: true,
    verifyMemberId: async () => ({ status: 'unavailable' }),
    getMyBootcamps,
    getMyWallet,
    getSubjects,
  }).map((tool) => tool.name);
  expect(tools).toEqual([
    'search_knowledge',
    'escalate_to_human',
    'end_call',
    'request_member_id',
    'verify_member_id',
    'get_my_bootcamps',
    'get_my_wallet',
    'get_subjects',
  ]);
  expect(tools).not.toContain('check_tutor_availability');
  expect(tools).not.toContain('book_course');
  expect(tools).toContain('request_member_id');
  expect(tools).toContain('verify_member_id');
  expect(tools).toContain('get_my_bootcamps');
  expect(tools).toContain('get_my_wallet');
  expect(tools).toContain('get_subjects');
  expect(tools).not.toContain('verify_account_email');
  expect(tools).not.toContain('request_account_details');
});

it('offers tutor self-availability only when the protected customer source is configured', () => {
  const t = createGateway();
  const getMyTutorAvailability = async () => ({
    status: 'unavailable' as const,
  });
  const enabled = createVoiceTools({
    retriever: t.retriever,
    escalations: t.escalations,
    accountActions: true,
    getMyTutorAvailability,
  }).map((tool) => tool.name);
  const disabled = createVoiceTools({
    retriever: t.retriever,
    escalations: t.escalations,
    accountActions: false,
    getMyTutorAvailability,
  }).map((tool) => tool.name);

  expect(enabled).toContain('get_my_tutor_availability');
  expect(disabled).not.toContain('get_my_tutor_availability');
});

it('does not advertise bootcamp access when the gateway capability is missing', () => {
  const t = createGateway();
  const tools = createVoiceTools({
    retriever: t.retriever,
    escalations: t.escalations,
    accountActions: true,
    verifyMemberId: async () => ({ status: 'unavailable' }),
  }).map((tool) => tool.name);

  expect(tools).not.toContain('get_my_bootcamps');
  expect(tools).not.toContain('get_my_wallet');
});

it('advertises the public subject catalog independently from account tools', () => {
  const t = createGateway();
  const tools = createVoiceTools({
    retriever: t.retriever,
    escalations: t.escalations,
    accountActions: false,
    getSubjects: async () => ({
      status: 'available',
      subjects: [],
    }),
  }).map((tool) => tool.name);

  expect(tools).toContain('get_subjects');
  expect(tools).not.toContain('check_subject_eligibility');
});

it('advertises direct booking only when all required booking capabilities are configured', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
  const t = createGateway();
  const createCourse = vi.fn(async () => ({
    status: 'booked' as const,
    courseId: 'course-1',
    sessionId: 'session-1',
    levelName: 'Grade 8',
    subjectName: 'Mathematics',
    tutorName: 'Taylor Tutor',
  }));
  const bookingDeps = {
    checkSubjectEligibility: async () => ({
      status: 'eligible' as const,
      subjectId: 'subject-1',
      subjectName: 'Mathematics',
      levelId: 'level-1',
      levelName: 'Grade 8',
      wallet: [{ bundleName: 'Math', credits: 1 }],
    }),
    getBookingLevels: async () => ({
      status: 'available' as const,
      entries: [{ id: 'level-1', name: 'Grade 8' }],
    }),
    getBookingSubjects: async () => ({
      status: 'available' as const,
      entries: [{ id: 'subject-1', name: 'Mathematics' }],
    }),
    findBookingTutors: async () => ({
      status: 'available' as const,
      tutors: [{ id: 'tutor-1', name: 'Taylor Tutor' }],
    }),
    getTutorBookingAvailability: async () => ({
      status: 'available' as const,
      slots: [{ date: '2026-11-20', timeFrom: '10:00', timeTo: '11:00' }],
    }),
  };
  const tools = createVoiceTools({
    retriever: t.retriever,
    escalations: t.escalations,
    accountActions: true,
    verifyMemberId: async () => ({ status: 'unavailable' }),
    getMyWallet: async () => ({
      status: 'available' as const,
      wallet: [{ creditName: 'Math', amount: 1 }],
    }),
    ...bookingDeps,
    createCourse,
  });

  expect(tools.map((tool) => tool.name)).toContain('book_course');
  expect(tools.map((tool) => tool.name)).toContain('start_course_booking');
  expect(tools.map((tool) => tool.name)).not.toContain(
    'check_tutor_availability',
  );
  expect(tools.map((tool) => tool.name)).toContain('get_booking_levels');
  expect(tools.map((tool) => tool.name)).toContain('get_booking_subjects');
  expect(tools.map((tool) => tool.name)).toContain('check_subject_eligibility');
  expect(tools.map((tool) => tool.name)).not.toContain('find_booking_tutors');
  expect(tools.map((tool) => tool.name)).toContain('request_member_id');

  const chainGateway = new ToolGateway(
    tools,
    { record: async () => undefined },
    logger,
  );
  const chainCall = context(true);
  chainCall.serverAccessToken = 'server-only-token';
  const chainResult = await chainGateway.execute(
    chainCall,
    'start_course_booking',
    JSON.stringify({ subjectName: 'Mathematics' }),
  );
  expect(JSON.parse(chainResult.output)).toMatchObject({
    status: 'available',
    subjectName: 'Mathematics',
    subjectId: 'subject-1',
    levelId: 'level-1',
    tutor: { id: 'tutor-1', name: 'Taylor Tutor' },
    slots: [{ date: '2026-11-20', timeFrom: '10:00', timeTo: '11:00' }],
  });
  expect(chainResult.followUpInstructions).toContain('In one concise response');

  const gateway = new ToolGateway(
    [createBookCourseTool(createCourse), ...confirmationTools()],
    {
      record: async () => undefined,
    },
    logger,
  );
  const call = context(true);
  call.serverAccessToken = 'server-only-token';
  await confirmBooking(gateway, call, '2026-11-20');
  const execution = await gateway.execute(
    call,
    'book_course',
    JSON.stringify({
      levelId: 'level-1',
      subjectId: 'subject-1',
      tutorId: 'tutor-1',
      date: '2026-11-20',
      timeFrom: '10:00',
      timeTo: '11:00',
      timeZone: 'UTC',
      description: 'Help with backend routing and server development',
    }),
  );
  expect(JSON.parse(execution.output)).toEqual({
    status: 'booked',
    date: '2026-11-20',
    timeFrom: '10:00',
    timeTo: '11:00',
    timeZone: 'UTC',
    level: 'Grade 8',
    subject: 'Mathematics',
    tutor: 'Taylor Tutor',
  });
  expect(createCourse).toHaveBeenCalledWith(
    'server-only-token',
    expect.objectContaining({ tutorId: 'tutor-1' }),
    call.context.sessionId,
  );
});

function createGateway(
  record: (entry: ToolInvocationEntry) => Promise<void> = async () => undefined,
) {
  const retriever = {
    search: vi.fn(async () => [
      {
        sourceId: 's1',
        title: 'FAQ',
        content: 'Passage text',
        language: 'en' as const,
        score: 0.9,
      },
    ]),
  };
  const escalations = {
    createFromVoiceSession: vi.fn(async () => ({
      ticketRef: 'ESC-1',
      priority: 'normal' as const,
    })),
  };
  const booking = {
    findBookingTutors: vi.fn(async (): Promise<BookingTutorsResult> => ({
      status: 'available',
      tutors: [{ id: 'tutor-1', name: 'Taylor Tutor' }],
    })),
    getTutorBookingAvailability: vi.fn(
      async (
        _token: string,
        _input: {
          tutorId: string;
          fromDate: string;
          toDate: string;
          timeZone: string;
        },
      ): Promise<BookingAvailabilityResult> => ({
        status: 'unavailable' as const,
      }),
    ),
  };
  const gateway = new ToolGateway(
    [
      createSearchKnowledgeTool(retriever),
      createRequestMemberIdTool(),
      createVerifyMemberIdTool(async () => ({ status: 'unavailable' })),
      createEscalateToHumanTool(escalations),
      createEndCallTool(),
      createFindBookingTutorsTool(booking.findBookingTutors),
      createCheckTutorAvailabilityTool(booking),
    ],
    { record },
    logger,
  );
  return { gateway, retriever, escalations, booking };
}

const calls: Array<[name: string, args: unknown]> = [
  ['search_knowledge', { query: 'price', language: 'en' }],
  ['request_member_id', {}],
  [
    'escalate_to_human',
    { reason: 'user_requested', summary: 'wants staff', contactConsent: true },
  ],
  ['end_call', {}],
  [
    'check_tutor_availability',
    {
      levelId: 'level-1',
      subjectId: 'subject-1',
      tutorPreference: 'specific',
      tutorId: 'tutor-1',
      preferredDays: ['Monday', 'Tuesday'],
      timeZone: 'UTC',
    },
  ],
];

function context(customerVerified: boolean, locale: Locale = 'en'): ToolCall {
  return {
    context: {
      sessionId: 's1',
      locale,
      retrieval: { topK: 5, minScore: 0.7 },
      responseExpectation: 'x',
    },
    callCounts: new Map<string, number>(),
    recordExpiresAt: new Date(Date.now() + 1_000_000),
    customerVerified,
    ...(customerVerified
      ? {
          serverRole: 'student',
          serverAccessToken: 'server-only-token',
        }
      : {}),
  };
}

async function runAll(gateway: ToolGateway, customerVerified: boolean) {
  const call = context(customerVerified);
  const results: Record<string, Record<string, unknown>> = {};
  for (const [name, args] of calls) {
    const execution = await gateway.execute(call, name, JSON.stringify(args));
    results[name] = {
      ...(JSON.parse(execution.output) as Record<string, unknown>),
      endCall: execution.endCall,
    };
  }
  return results;
}

describe('tool access by account status', () => {
  it('allows ending and escalation for everyone but keeps account actions restricted', async () => {
    const t = createGateway();
    const results = await runAll(t.gateway, false);

    expect(results.search_knowledge).toMatchObject({ found: true });
    expect(results.request_member_id).toMatchObject({
      status: 'waiting_for_member_id',
    });
    expect(results.escalate_to_human).toMatchObject({ status: 'created' });
    expect(results.end_call).toMatchObject({ status: 'ending', endCall: true });
    expect(results.check_tutor_availability).toMatchObject({
      error: 'denied',
      reason: 'ACCOUNT_NOT_VERIFIED',
      endCall: false,
    });
    expect(t.escalations.createFromVoiceSession).toHaveBeenCalledOnce();
    expect(t.booking.findBookingTutors).not.toHaveBeenCalled();
  });

  it('explains how account-access requests map to an allowed escalation reason', () => {
    const t = createGateway();
    const tool = t.gateway
      .realtimeTools()
      .find((definition) => definition.name === 'escalate_to_human');

    expect(tool?.description).toContain(
      'user_requested for a caller who wants a person or help with registration/sign-in/account access',
    );
    expect(tool?.description).toContain('account verification is not required');
  });

  it('gives a registered caller every tool', async () => {
    const t = createGateway();
    const results = await runAll(t.gateway, true);

    expect(results.search_knowledge).toMatchObject({ found: true });
    expect(results.request_member_id).toMatchObject({
      error: 'denied',
      reason: 'ALREADY_VERIFIED',
    });
    expect(results.escalate_to_human).toMatchObject({ status: 'created' });
    expect(results.end_call).toMatchObject({ status: 'ending', endCall: true });
    expect(results.check_tutor_availability).toMatchObject({
      status: 'unavailable',
    });
    expect(t.escalations.createFromVoiceSession).toHaveBeenCalledOnce();
    expect(t.booking.findBookingTutors).toHaveBeenCalledOnce();
  });

  it('allows a verified parent to use the student booking tool set', async () => {
    const t = createGateway();
    const call = context(true);
    call.serverRole = 'parent';

    const result = await t.gateway.execute(
      call,
      'check_tutor_availability',
      JSON.stringify(calls[4]![1]),
    );

    expect(JSON.parse(result.output)).toMatchObject({ status: 'unavailable' });
    expect(t.booking.findBookingTutors).toHaveBeenCalledOnce();
  });

  it('does not require account verification to end a call', async () => {
    const t = createGateway();
    const call = context(false);
    const result = await t.gateway.execute(call, 'end_call', '{}');

    expect(JSON.parse(result.output)).toMatchObject({ status: 'ending' });
    expect(result.endCall).toBe(true);
    expect(call.callCounts.get('end_call')).toBe(1);
  });

  it('denies a tool when a verified caller has the wrong role', async () => {
    const t = createGateway();
    const call = context(true);
    call.serverRole = 'tutor';

    const result = await t.gateway.execute(
      call,
      'check_tutor_availability',
      JSON.stringify(calls[4]![1]),
    );

    expect(JSON.parse(result.output)).toEqual({
      error: 'denied',
      reason: 'ROLE_NOT_AUTHORIZED',
    });
    expect(t.booking.findBookingTutors).not.toHaveBeenCalled();
  });

  it('prevents repeating the spoken member-ID prompt during one call', async () => {
    const { gateway } = createGateway();
    const call = context(false);

    await gateway.execute(call, 'request_member_id', '{}');
    const second = await gateway.execute(call, 'request_member_id', '{}');

    expect(JSON.parse(second.output)).toEqual({
      error: 'denied',
      reason: 'TOOL_LIMIT',
    });
    expect(second.followUpInstructions).toContain(
      'The member-ID question was already asked.',
    );
  });

  it('does not request the member ID again after verification', async () => {
    const verify = vi.fn(async () => ({
      status: 'verified' as const,
      serverAccessToken: 'should-not-be-used',
      serverRole: 'student',
    }));
    const gateway = new ToolGateway(
      [createRequestMemberIdTool(), createVerifyMemberIdTool(verify)],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.callCounts.set('request_member_id', 1);
    const result = await gateway.execute(
      call,
      'request_member_id',
      JSON.stringify({}),
    );

    expect(JSON.parse(result.output)).toEqual({
      error: 'denied',
      reason: 'ALREADY_VERIFIED',
    });
    expect(result.allowToolCalls).toBe(true);
    expect(result.followUpInstructions).toContain(
      'already verified for this call',
    );

    expect(verify).not.toHaveBeenCalled();
    expect(call.callCounts.get('request_member_id')).toBe(1);
  });

  it('uses the channel-specific localized account-access prompt', async () => {
    const { gateway } = createGateway();
    const call = context(false, 'fr');
    call.context.accountAccessHint =
      'Veuillez indiquer votre identifiant membre.';
    const result = await gateway.execute(
      call,
      'check_tutor_availability',
      JSON.stringify(calls[4]![1]),
    );

    expect(result.followUpInstructions).toBe(
      'Veuillez indiquer votre identifiant membre.',
    );
  });

  it('redacts spoken member IDs and retains the login token only in server state', async () => {
    const records: ToolInvocationEntry[] = [];
    const verify = vi.fn(async () => ({
      status: 'verified' as const,
      serverAccessToken: 'private-token',
      serverRole: 'student',
    }));
    const gateway = new ToolGateway(
      [createVerifyMemberIdTool(verify)],
      { record: async (entry) => void records.push(entry) },
      logger,
    );
    const call = context(false);
    const result = await gateway.execute(
      call,
      'verify_member_id',
      JSON.stringify({ memberId: '0001234' }),
    );

    expect(JSON.parse(result.output)).toEqual({ status: 'verified' });
    expect(result.output).not.toContain('private-token');
    expect(result.customerVerified).toBe(true);
    expect(result.serverAccessToken).toBe('private-token');
    expect(result.allowToolCalls).toBe(true);
    expect(JSON.stringify(records)).not.toContain('0001234');
    expect(JSON.stringify(records)).not.toContain('private-token');
    expect(verify).toHaveBeenCalledWith('s1', '0001234');
  });

  it('accepts backend-defined member-ID lengths and removes only trailing speech punctuation', async () => {
    const verify = vi.fn(async () => ({
      status: 'verified' as const,
      serverAccessToken: 'private-token',
      serverRole: 'student',
    }));
    const gateway = new ToolGateway(
      [createVerifyMemberIdTool(verify)],
      { record: async () => undefined },
      logger,
    );
    const call = context(false);

    const result = await gateway.execute(
      call,
      'verify_member_id',
      JSON.stringify({ memberId: 'A-01.' }),
    );

    expect(JSON.parse(result.output)).toEqual({ status: 'verified' });
    expect(call.callCounts.get('verify_member_id')).toBe(1);
    expect(verify).toHaveBeenCalledWith('s1', 'A-01');
  });

  it.each([
    ['not_registered', 'not_verified'],
    ['unavailable', 'unavailable'],
  ] as const)(
    'does not unlock account actions when member verification is %s',
    async (verificationStatus, resultStatus) => {
      const gateway = new ToolGateway(
        [
          createVerifyMemberIdTool(async () => ({
            status: verificationStatus,
          })),
        ],
        { record: async () => undefined },
        logger,
      );
      const result = await gateway.execute(
        context(false),
        'verify_member_id',
        JSON.stringify({ memberId: '0001234' }),
      );

      expect(JSON.parse(result.output)).toEqual({ status: resultStatus });
      expect(result.customerVerified).toBe(false);
      expect(result.serverAccessToken).toBeUndefined();
      expect(result.followUpInstructions).toContain(
        verificationStatus === 'not_registered'
          ? 'Briefly say you could not verify the member ID'
          : 'Briefly explain that account verification is temporarily unavailable',
      );
      expect(result.output).not.toContain('0001234');
    },
  );

  it('clears verified access when member verification throws', async () => {
    const verify = vi.fn(async () => {
      throw new Error('upstream unavailable');
    });
    const gateway = new ToolGateway(
      [createVerifyMemberIdTool(verify)],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'prior-token';
    const result = await gateway.execute(
      call,
      'verify_member_id',
      JSON.stringify({ memberId: '0001234' }),
    );

    expect(JSON.parse(result.output)).toEqual({ error: 'TOOL_FAILED' });
    expect(result.customerVerified).toBe(false);
    expect(result.serverAccessToken).toBeUndefined();
    expect(call.customerVerified).toBe(false);
    expect(call.serverAccessToken).toBeUndefined();
    expect(result.followUpInstructions).toContain(
      'Verification did not complete.',
    );
    expect(JSON.stringify(result)).not.toContain('prior-token');
    expect(JSON.stringify(result)).not.toContain('0001234');
  });
});

describe('tool definitions', () => {
  it('offers the model plain function definitions with usable JSON schemas', () => {
    const { gateway } = createGateway();
    const tools = gateway.realtimeTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'end_call',
      'escalate_to_human',
      'request_member_id',
      'search_knowledge',
      'verify_member_id',
    ]);
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters).toMatchObject({ type: 'object' });
      expect(tool.parameters).not.toHaveProperty('$schema');
    }
    expect(
      tools.find((tool) => tool.name === 'request_member_id')?.description,
    ).toContain('personal wallet lookup');
  });

  it('advertises only the verified caller’s role-specific tools', () => {
    const { gateway } = createGateway();
    const toolsForRole = (serverRole: string) =>
      gateway
        .realtimeTools({ customerVerified: true, serverRole })
        .map((tool) => tool.name)
        .sort();

    expect(gateway.realtimeTools().map((tool) => tool.name)).not.toContain(
      'check_tutor_availability',
    );
    expect(
      gateway
        .realtimeTools({ customerVerified: true, serverRole: 'student' })
        .map((tool) => tool.name),
    ).toContain('check_tutor_availability');
    expect(toolsForRole('parent')).toEqual(toolsForRole('student'));
    expect(
      gateway
        .realtimeTools({ customerVerified: true, serverRole: 'tutor' })
        .map((tool) => tool.name),
    ).not.toContain('check_tutor_availability');
  });

  it('states account requirements only for protected tools', () => {
    const tools = new Map(
      createGateway()
        .gateway.realtimeTools()
        .map((tool): [string, string] => [tool.name, tool.description]),
    );
    const studentTools = new Map(
      createGateway()
        .gateway.realtimeTools({
          customerVerified: true,
          serverRole: 'student',
        })
        .map((tool): [string, string] => [tool.name, tool.description]),
    );
    expect(studentTools.get('check_tutor_availability')).toContain(
      'verified, registered customer',
    );
    expect(tools.get('end_call')).toContain('Available to any caller');
    expect(tools.get('end_call')).toContain('thank-you and goodbye');
    expect(tools.get('escalate_to_human')).toContain('Available to any caller');
    expect(tools.get('escalate_to_human')).toContain(
      'Never ask for, repeat, or pass a phone number',
    );
    expect(tools.get('search_knowledge')).not.toContain('verified, registered');
    expect(tools.get('search_knowledge')).toContain('never call silently');
    expect(tools.get('search_knowledge')).toContain(
      'mention searching, tools, or sources',
    );
    expect(tools.get('search_knowledge')).toContain(
      'Reuse the exact subject, course, or service named by the caller',
    );
    expect(tools.get('search_knowledge')).toContain(
      'Send a concise query preserving the exact topic and intent',
    );
    const searchTool = createGateway()
      .gateway.realtimeTools()
      .find((tool) => tool.name === 'search_knowledge');
    expect(searchTool?.parameters).toMatchObject({
      properties: {
        query: {
          description: expect.stringContaining(
            'Send a concise query in the caller’s language',
          ),
        },
      },
    });
    expect(tools.get('search_knowledge')).toContain(
      'do not call for unrelated questions',
    );
  });
});

describe('search_knowledge', () => {
  it('returns quoted passages with their sources and a safety notice', async () => {
    const t = createGateway();
    const call = context(false);
    const result = await t.gateway.execute(
      call,
      'search_knowledge',
      JSON.stringify({ query: 'price', language: 'en' }),
    );

    expect(JSON.parse(result.output)).toMatchObject({
      found: true,
      passages: [{ sourceId: 's1', title: 'FAQ', text: 'Passage text' }],
      sourceIds: ['s1'],
    });
    expect(result.citations).toEqual([{ sourceId: 's1', title: 'FAQ' }]);
  });

  it('refuses a search in another language than the call', async () => {
    const t = createGateway();
    const result = await t.gateway.execute(
      context(false),
      'search_knowledge',
      JSON.stringify({ query: 'prix', language: 'fr' }),
    );

    expect(JSON.parse(result.output)).toEqual({
      error: 'denied',
      reason: 'LOCALE_MISMATCH',
    });
    expect(t.retriever.search).not.toHaveBeenCalled();
  });

  it('reports not found without inventing passages', async () => {
    const t = createGateway();
    t.retriever.search.mockResolvedValue([]);
    const result = await t.gateway.execute(
      context(false),
      'search_knowledge',
      JSON.stringify({ query: 'unknown topic', language: 'en' }),
    );

    expect(JSON.parse(result.output)).toMatchObject({
      found: false,
      passages: [],
    });
    expect(result.citations).toEqual([]);
  });

  it('allows at most 20 searches per call', async () => {
    const t = createGateway();
    const call = context(false);
    const args = JSON.stringify({ query: 'q', language: 'en' });
    for (let i = 0; i < 20; i += 1) {
      await t.gateway.execute(call, 'search_knowledge', args);
    }
    const result = await t.gateway.execute(call, 'search_knowledge', args);

    expect(JSON.parse(result.output)).toEqual({
      error: 'denied',
      reason: 'TOOL_LIMIT',
    });
  });
});

describe('escalate_to_human', () => {
  it('creates a ticket only after explicit contact consent', async () => {
    const t = createGateway();
    const call = context(true);
    const result = await t.gateway.execute(
      call,
      'escalate_to_human',
      JSON.stringify({
        reason: 'complaint',
        summary: 'Unhappy with a lesson',
        contactConsent: true,
      }),
    );

    expect(t.escalations.createFromVoiceSession).toHaveBeenCalledWith({
      sessionId: 's1',
      reason: 'complaint',
      summary: 'Unhappy with a lesson',
      contactConsent: true,
    });
    expect(JSON.parse(result.output)).toEqual({ status: 'created' });
    expect(result.output).not.toContain('ESC-1');
    expect(result.followUpInstructions).toContain(
      'Your follow-up request has been recorded for our team.',
    );
    expect(result.followUpInstructions).toContain('exactly once');
    expect(result.followUpInstructions).not.toContain('soon');
  });

  it('refuses ticket creation without consent or model-supplied contact details', async () => {
    const t = createGateway();
    const result = await t.gateway.execute(
      context(true),
      'escalate_to_human',
      JSON.stringify({
        reason: 'complaint',
        summary: 'Unhappy',
        contactConsent: false,
      }),
    );

    expect(JSON.parse(result.output)).toEqual({
      error: 'denied',
      reason: 'INVALID_ARGUMENTS',
    });
    expect(t.escalations.createFromVoiceSession).not.toHaveBeenCalled();

    const withModelPhone = await t.gateway.execute(
      context(false),
      'escalate_to_human',
      JSON.stringify({
        reason: 'complaint',
        summary: 'Unhappy',
        contactConsent: true,
        contactPhone: '+966500000000',
      }),
    );
    expect(JSON.parse(withModelPhone.output)).toEqual({
      error: 'denied',
      reason: 'INVALID_ARGUMENTS',
    });
    expect(t.escalations.createFromVoiceSession).not.toHaveBeenCalled();
  });

  it('allows two escalations per call', async () => {
    const t = createGateway();
    const call = context(true);
    const args = JSON.stringify({
      reason: 'user_requested',
      summary: 'Wants staff',
      contactConsent: true,
    });
    await t.gateway.execute(call, 'escalate_to_human', args);
    await t.gateway.execute(call, 'escalate_to_human', args);
    const third = await t.gateway.execute(call, 'escalate_to_human', args);

    expect(JSON.parse(third.output)).toMatchObject({ reason: 'TOOL_LIMIT' });
    expect(t.escalations.createFromVoiceSession).toHaveBeenCalledTimes(2);
  });
});

describe('check_tutor_availability', () => {
  it('revalidates the tutor selection and returns caller-local slots with a weekday', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    const t = createGateway();
    t.booking.getTutorBookingAvailability.mockImplementation(
      async (_token, _input) => ({
        status: 'available',
        slots: [
          { date: '2026-11-16', timeFrom: '10:00', timeTo: '11:00' },
          { date: '2026-11-16', timeFrom: '11:00', timeTo: '12:00' },
        ],
      }),
    );
    const result = await t.gateway.execute(
      context(true),
      'check_tutor_availability',
      JSON.stringify(calls[4]![1]),
    );

    const output = JSON.parse(result.output) as Record<string, unknown>;
    expect(output).toMatchObject({
      status: 'available',
      tutor: { id: 'tutor-1', name: 'Taylor Tutor' },
      timeZone: 'UTC',
      date: '2026-11-16',
      weekday: 'Monday',
      slots: [
        {
          date: '2026-11-16',
          weekday: 'Monday',
          timeFrom: '10:00',
          timeTo: '11:00',
        },
        {
          date: '2026-11-16',
          weekday: 'Monday',
          timeFrom: '11:00',
          timeTo: '12:00',
        },
      ],
    });
    expect(t.booking.findBookingTutors).toHaveBeenCalledWith(
      'server-only-token',
      {
        subjectId: 'subject-1',
        levelId: 'level-1',
        locale: 'en',
      },
    );
    expect(t.booking.getTutorBookingAvailability).toHaveBeenCalledWith(
      'server-only-token',
      {
        tutorId: 'tutor-1',
        fromDate: '2026-11-15',
        toDate: '2026-11-28',
        timeZone: 'UTC',
      },
    );
  });

  it('searches multiple preferred weekdays together and resumes from the returned cursor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    const t = createGateway();
    t.booking.getTutorBookingAvailability
      .mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(21_000);
        return { status: 'available', slots: [] };
      })
      .mockImplementationOnce(async () => ({
        status: 'available',
        slots: [{ date: '2026-11-30', timeFrom: '10:00', timeTo: '11:00' }],
      }));

    const firstResult = await t.gateway.execute(
      context(true),
      'check_tutor_availability',
      JSON.stringify({
        levelId: 'level-1',
        subjectId: 'subject-1',
        tutorPreference: 'specific',
        tutorId: 'tutor-1',
        preferredDays: ['Monday', 'Tuesday'],
        timeZone: 'UTC',
      }),
    );
    const incomplete = JSON.parse(firstResult.output) as {
      status: string;
      searchedDays: string[];
      searchedThroughDate: string;
      nextSearchDate: string;
    };

    expect(incomplete).toEqual({
      status: 'search_incomplete',
      searchedDays: ['Monday', 'Tuesday'],
      searchedThroughDate: '2026-11-28',
      nextSearchDate: '2026-11-29',
    });
    expect(firstResult.followUpInstructions).toContain(
      'does not establish that no slots exist',
    );
    expect(t.booking.getTutorBookingAvailability).toHaveBeenNthCalledWith(
      1,
      'server-only-token',
      {
        tutorId: 'tutor-1',
        fromDate: '2026-11-15',
        toDate: '2026-11-28',
        timeZone: 'UTC',
      },
    );

    const resumedResult = await t.gateway.execute(
      context(true),
      'check_tutor_availability',
      JSON.stringify({
        levelId: 'level-1',
        subjectId: 'subject-1',
        tutorPreference: 'specific',
        tutorId: 'tutor-1',
        preferredDays: ['Monday', 'Tuesday'],
        timeZone: 'UTC',
        searchFromDate: incomplete.nextSearchDate,
      }),
    );

    expect(JSON.parse(resumedResult.output)).toMatchObject({
      status: 'available',
      date: '2026-11-30',
      weekday: 'Monday',
    });
    expect(t.booking.getTutorBookingAvailability).toHaveBeenNthCalledWith(
      2,
      'server-only-token',
      {
        tutorId: 'tutor-1',
        fromDate: '2026-11-29',
        toDate: '2026-12-12',
        timeZone: 'UTC',
      },
    );
  });

  it('does not present a tutor as bookable when the upstream flag is false', async () => {
    const t = createGateway();
    t.booking.getTutorBookingAvailability.mockResolvedValue({
      status: 'not_bookable',
    });

    const result = await t.gateway.execute(
      context(true),
      'check_tutor_availability',
      JSON.stringify(calls[4]![1]),
    );

    expect(JSON.parse(result.output)).toEqual({ status: 'no_availability' });
    expect(result.followUpInstructions).toContain(
      'no bookable slots were returned',
    );
  });

  it('selects the tutor with the nearest slot and returns all slots for that date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    const t = createGateway();
    t.booking.findBookingTutors.mockResolvedValue({
      status: 'available',
      tutors: [
        {
          id: 'tutor-1',
          name: 'Taylor Tutor',
          profilePic: 'https://cdn.example.com/taylor.jpg',
        },
        { id: 'tutor-2', name: 'Jordan Tutor' },
      ],
    });
    t.booking.getTutorBookingAvailability.mockImplementation(
      async (_token, input) => ({
        status: 'available',
        slots:
          input.tutorId === 'tutor-2'
            ? [
                { date: input.fromDate, timeFrom: '09:00', timeTo: '10:00' },
                { date: input.fromDate, timeFrom: '10:00', timeTo: '11:00' },
              ]
            : [],
      }),
    );
    const result = await t.gateway.execute(
      context(true),
      'check_tutor_availability',
      JSON.stringify({
        levelId: 'level-1',
        subjectId: 'subject-1',
      }),
    );

    expect(JSON.parse(result.output)).toMatchObject({
      status: 'available',
      tutor: { id: 'tutor-2', name: 'Jordan Tutor' },
      date: '2026-11-15',
      weekday: 'Sunday',
      slots: [
        { timeFrom: '09:00', timeTo: '10:00', weekday: 'Sunday' },
        { timeFrom: '10:00', timeTo: '11:00', weekday: 'Sunday' },
      ],
    });
    expect(t.booking.getTutorBookingAvailability).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid preferred weekday', async () => {
    const t = createGateway();
    const result = await t.gateway.execute(
      context(true),
      'check_tutor_availability',
      JSON.stringify({
        levelId: 'level-1',
        subjectId: 'subject-1',
        tutorPreference: 'specific',
        tutorId: 'tutor-1',
        preferredDays: ['tomorrow'],
      }),
    );

    expect(JSON.parse(result.output)).toMatchObject({
      reason: 'INVALID_ARGUMENTS',
    });
    expect(t.booking.findBookingTutors).not.toHaveBeenCalled();
  });
});

describe('find_booking_tutors', () => {
  it('asks the caller to choose a tutor or request the nearest when several are listed', async () => {
    const t = createGateway();
    t.booking.findBookingTutors.mockResolvedValue({
      status: 'available',
      tutors: [
        {
          id: 'tutor-1',
          name: 'Taylor Tutor',
          profilePic: 'https://cdn.example.com/taylor.jpg',
        },
        { id: 'tutor-2', name: 'Jordan Tutor' },
      ],
    });

    const result = await t.gateway.execute(
      context(true),
      'find_booking_tutors',
      JSON.stringify({ levelId: 'level-1', subjectId: 'subject-1' }),
    );

    expect(JSON.parse(result.output)).toMatchObject({
      status: 'available',
      tutors: [{ name: 'Taylor Tutor' }, { name: 'Jordan Tutor' }],
      uiTutorProfiles: [
        {
          fullName: 'Taylor Tutor',
          profilePic: 'https://cdn.example.com/taylor.jpg',
        },
      ],
    });
    expect(result.followUpInstructions).toContain('specific one');
    expect(result.followUpInstructions).toContain('nearest available');
    expect(result.followUpInstructions).toContain(
      'call check_tutor_availability immediately',
    );
    expect(result.followUpInstructions).toContain(
      'Say every tutor name exactly as returned',
    );
    expect(result.followUpInstructions).toContain(
      'Never read, describe, or mention profilePic',
    );
    expect(result.followUpInstructions).not.toContain(
      'what country they are in',
    );
  });

  it('does not suggest changing tutor when only one tutor is listed', async () => {
    const t = createGateway();
    const result = await t.gateway.execute(
      context(true),
      'find_booking_tutors',
      JSON.stringify({ levelId: 'level-1', subjectId: 'subject-1' }),
    );

    expect(result.followUpInstructions).toContain('only tutor listed');
    expect(result.followUpInstructions).not.toContain('specific tutor');
    expect(result.followUpInstructions).toContain(
      'Do not ask for country, city, region, country code, or time zone',
    );
  });
});

describe('book_course', () => {
  const bookingArgs = {
    levelId: 'level-1',
    subjectId: 'subject-1',
    tutorId: 'tutor-1',
    date: '2026-11-22',
    timeFrom: '10:00',
    timeTo: '11:00',
    timeZone: 'UTC',
    description: 'Help with backend routing and server development',
  };

  it('allows one retry only after a definitive stale-slot result', async () => {
    const createCourse = vi
      .fn()
      .mockResolvedValueOnce({ status: 'slot_unavailable' as const })
      .mockResolvedValueOnce({
        status: 'booked' as const,
        courseId: 'course-1',
        sessionId: 'session-1',
        levelName: 'Grade 8',
        subjectName: 'Mathematics',
        tutorName: 'Taylor Tutor',
      });
    const gateway = new ToolGateway(
      [createBookCourseTool(createCourse), ...confirmationTools()],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);

    await confirmBooking(gateway, call, bookingArgs.date);
    const first = await gateway.execute(
      call,
      'book_course',
      JSON.stringify(bookingArgs),
    );
    expect(JSON.parse(first.output)).toEqual({ status: 'slot_unavailable' });
    expect(first.followUpInstructions).toContain('fresh explicit confirmation');

    await confirmBooking(gateway, call, bookingArgs.date, '11:00', '12:00');
    const second = await gateway.execute(
      call,
      'book_course',
      JSON.stringify({
        ...bookingArgs,
        timeFrom: '11:00',
        timeTo: '12:00',
        description: 'A different paraphrased description',
      }),
    );
    expect(JSON.parse(second.output)).toMatchObject({
      status: 'booked',
    });
    expect(createCourse).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        description: bookingArgs.description,
      }),
      call.context.sessionId,
    );

    const third = await gateway.execute(
      call,
      'book_course',
      JSON.stringify(bookingArgs),
    );
    expect(JSON.parse(third.output)).toMatchObject({
      error: 'denied',
      reason: 'TOOL_LIMIT',
    });
    expect(createCourse).toHaveBeenCalledTimes(2);
  });

  it('does not retry after an unclear booking result', async () => {
    const createCourse = vi
      .fn()
      .mockResolvedValue({ status: 'unknown' as const });
    const gateway = new ToolGateway(
      [createBookCourseTool(createCourse), ...confirmationTools()],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);

    const first = await gateway.execute(
      call,
      'book_course',
      JSON.stringify(bookingArgs),
    );
    expect(JSON.parse(first.output)).toEqual({
      error: 'denied',
      reason: 'BOOKING_CONFIRMATION_REQUIRED',
    });
    expect(createCourse).not.toHaveBeenCalled();
    await confirmBooking(gateway, call, bookingArgs.date);
    const confirmed = await gateway.execute(
      call,
      'book_course',
      JSON.stringify(bookingArgs),
    );
    expect(JSON.parse(confirmed.output)).toEqual({ status: 'unknown' });

    const retry = await gateway.execute(
      call,
      'book_course',
      JSON.stringify(bookingArgs),
    );
    expect(JSON.parse(retry.output)).toMatchObject({
      error: 'denied',
      reason: 'TOOL_LIMIT',
    });
    expect(createCourse).toHaveBeenCalledOnce();
  });
});

describe('get_my_bootcamps', () => {
  it('instructs the model to call it without requiring the caller to name it', () => {
    const tool = createGetMyBootcampsTool(async () => ({
      status: 'unavailable',
    }));

    expect(tool.description).toContain('Call immediately');
    expect(tool.description).toContain(
      'without asking the caller to repeat the request or name the tool',
    );
    expect(tool.description).toContain(
      'Do not say bootcamp access is unavailable while this tool is listed',
    );
    expect(tool.description).toContain(
      'Tell the caller the name of each returned bootcamp',
    );
  });

  it('uses the login token from server verification and returns only backend data', async () => {
    const getMyBootcamps = vi.fn(async () => ({
      status: 'available' as const,
      data: {
        bootcamps: [
          {
            name: {
              en: 'React, NodeJS, Express & MongoDB - The MERN Fullstack Guide',
            },
            unlocked: true,
          },
        ],
      },
    }));
    const records: ToolInvocationEntry[] = [];
    const gateway = new ToolGateway(
      [
        createVerifyMemberIdTool(async () => ({
          status: 'verified',
          serverAccessToken: 'server-only-token',
          serverRole: 'student',
        })),
        createGetMyBootcampsTool(getMyBootcamps),
      ],
      { record: async (entry) => void records.push(entry) },
      logger,
    );
    const call = context(false);

    await gateway.execute(
      call,
      'verify_member_id',
      JSON.stringify({ memberId: '1234567' }),
    );

    const result = await gateway.execute(call, 'get_my_bootcamps', '{}');

    expect(getMyBootcamps).toHaveBeenCalledWith('server-only-token');
    expect(call.customerVerified).toBe(true);
    expect(JSON.parse(result.output)).toEqual({
      status: 'available',
      data: {
        bootcamps: [
          {
            name: {
              en: 'React, NodeJS, Express & MongoDB - The MERN Fullstack Guide',
            },
            unlocked: true,
          },
        ],
      },
    });
    expect(result.followUpInstructions).toContain(
      'Tell the caller the name of every bootcamp',
    );
    expect(result.followUpInstructions).toContain(
      'Say the title as written; do not translate or omit it.',
    );
    expect(result.output).not.toContain('server-only-token');
    await Promise.resolve();
    expect(JSON.stringify(records)).not.toContain('server-only-token');
    expect(JSON.stringify(records)).not.toContain('1234567');
  });

  it('requires verification and does not call the backend for an unverified caller', async () => {
    const getMyBootcamps = vi.fn(async () => ({
      status: 'available' as const,
      data: { bootcamps: [] },
    }));
    const gateway = new ToolGateway(
      [createGetMyBootcampsTool(getMyBootcamps)],
      { record: async () => undefined },
      logger,
    );

    const result = await gateway.execute(
      context(false),
      'get_my_bootcamps',
      '{}',
    );

    expect(JSON.parse(result.output)).toMatchObject({
      error: 'denied',
      reason: 'ACCOUNT_NOT_VERIFIED',
    });
    expect(getMyBootcamps).not.toHaveBeenCalled();
  });

  it('does not claim to have checked bootcamps when the endpoint is unavailable', async () => {
    const gateway = new ToolGateway(
      [
        createGetMyBootcampsTool(async () => ({
          status: 'unavailable',
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';

    const result = await gateway.execute(call, 'get_my_bootcamps', '{}');

    expect(JSON.parse(result.output)).toEqual({ status: 'unavailable' });
    expect(result.followUpInstructions).toContain(
      'could not retrieve the bootcamp information',
    );
  });
});

describe('get_my_tutor_availability', () => {
  it('only performs the lookup for a verified tutor and gives a concise result', async () => {
    const getAvailability = vi.fn(async () => ({
      status: 'available' as const,
      data: { availability: [{ day: 'Monday', from: '09:00' }] },
    }));
    const gateway = new ToolGateway(
      [
        createVerifyMemberIdTool(async () => ({
          status: 'verified',
          serverAccessToken: 'server-only-token',
          serverRole: 'tutor',
        })),
        createGetMyTutorAvailabilityTool(getAvailability),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(false);

    await gateway.execute(
      call,
      'verify_member_id',
      JSON.stringify({ memberId: '1234567' }),
    );
    const result = await gateway.execute(
      call,
      'get_my_tutor_availability',
      '{}',
    );

    // The caller's zone must reach the platform, or the slots come back
    // rendered in the platform's own server zone.
    expect(getAvailability).toHaveBeenCalledWith('server-only-token', 'UTC');
    expect(JSON.parse(result.output)).toEqual({
      status: 'available',
      availability: { availability: [{ day: 'Monday', from: '09:00' }] },
    });
    expect(result.followUpInstructions).toContain(
      'Filter the returned availability yourself to the caller’s original requested date/time period only',
    );
    expect(result.followUpInstructions).toContain(
      'Today’s date in the call time zone (UTC) is',
    );
    expect(result.output).not.toContain('server-only-token');
    expect(JSON.stringify(result)).not.toContain('1234567');
  });

  it('refuses the lookup for a verified non-tutor without calling the endpoint', async () => {
    const getAvailability = vi.fn(async () => ({
      status: 'available' as const,
      data: { availability: [{ day: 'Monday' }] },
    }));
    const gateway = new ToolGateway(
      [
        createVerifyMemberIdTool(async () => ({
          status: 'verified',
          serverAccessToken: 'server-only-token',
          serverRole: 'student',
        })),
        createGetMyTutorAvailabilityTool(getAvailability),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(false);

    await gateway.execute(
      call,
      'verify_member_id',
      JSON.stringify({ memberId: '1234567' }),
    );
    const result = await gateway.execute(
      call,
      'get_my_tutor_availability',
      '{}',
    );

    expect(JSON.parse(result.output)).toEqual({
      error: 'denied',
      reason: 'ROLE_NOT_AUTHORIZED',
    });
    expect(getAvailability).not.toHaveBeenCalled();
  });
});

describe('get_my_wallet', () => {
  it('reports no credits and suggests a bundle when every amount is zero', async () => {
    const getMyWallet = vi.fn(async () => ({
      status: 'available' as const,
      wallet: [
        { creditName: 'Mathematics', level: 'Elementary', amount: 0 },
        { creditName: 'Science', level: 'Advanced', amount: 0 },
      ],
    }));
    const records: ToolInvocationEntry[] = [];
    const gateway = new ToolGateway(
      [
        createVerifyMemberIdTool(async () => ({
          status: 'verified',
          serverAccessToken: 'server-only-token',
          serverRole: 'student',
        })),
        createGetMyWalletTool(getMyWallet),
      ],
      { record: async (entry) => void records.push(entry) },
      logger,
    );
    const call = context(false);

    const verification = await gateway.execute(
      call,
      'verify_member_id',
      JSON.stringify({ memberId: '1234567' }),
    );

    expect(verification.followUpInstructions).toContain(
      'If they asked about eligibility or booking for a named course, call check_subject_eligibility once with the course name',
    );
    expect(verification.followUpInstructions).toContain(
      'Do not separately call get_subjects or get_my_wallet for that flow',
    );
    expect(verification.followUpInstructions).toContain(
      'pass the returned subjectId and levelId unchanged to find_booking_tutors',
    );
    const result = await gateway.execute(call, 'get_my_wallet', '{}');

    expect(getMyWallet).toHaveBeenCalledWith('server-only-token');
    expect(JSON.parse(result.output)).toEqual({
      status: 'available',
      wallet: [
        { bundleName: 'Mathematics', credits: 0 },
        { bundleName: 'Science', credits: 0 },
      ],
    });
    expect(result.followUpInstructions).toContain(
      'Report each returned bundleName and its credits',
    );
    expect(result.followUpInstructions).toContain(
      'there are no available credits',
    );
    expect(result.allowToolCalls).toBe(true);
    expect(result.followUpInstructions).toContain(
      'Show bundle options only after the caller explicitly asks for them.',
    );
    expect(result.followUpInstructions).toContain(
      'Do not imply a purchase or continue booking.',
    );
    expect(result.output).not.toContain('server-only-token');
    await Promise.resolve();
    expect(JSON.stringify(records)).not.toContain('server-only-token');
    expect(JSON.stringify(records)).not.toContain('1234567');
  });

  it('treats an empty wallet as having no available credits', async () => {
    const gateway = new ToolGateway(
      [
        createGetMyWalletTool(async () => ({
          status: 'available',
          wallet: [],
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';

    const result = await gateway.execute(call, 'get_my_wallet', '{}');

    expect(JSON.parse(result.output)).toEqual({
      status: 'available',
      wallet: [],
    });
    expect(result.followUpInstructions).toContain('recommend_course_bundle');
  });

  it('summarizes unique positive-credit levels without exposing zero-credit levels', async () => {
    const gateway = new ToolGateway(
      [
        createGetMyWalletTool(async () => ({
          status: 'available',
          wallet: [
            { creditName: 'Mathematics', level: 'Elementary', amount: 4 },
            { creditName: 'Science', level: 'Advanced', amount: 0 },
            { creditName: 'Another bundle', level: ' Elementary ', amount: 2 },
          ],
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';

    const result = await gateway.execute(
      call,
      'get_my_wallet',
      JSON.stringify({ includeCourseAccessLevels: true }),
    );

    expect(JSON.parse(result.output)).toEqual({
      status: 'available',
      wallet: [
        { bundleName: 'Mathematics', credits: 4 },
        { bundleName: 'Science', credits: 0 },
        { bundleName: 'Another bundle', credits: 2 },
      ],
      positiveCreditLevels: ['Elementary'],
      positiveCreditLevelsComplete: true,
    });
    expect(result.followUpInstructions).toContain(
      'Only when the caller asks generally which courses their wallet gives access to',
    );
    expect(result.followUpInstructions).toContain(
      'Report each returned bundleName',
    );
    expect(result.allowToolCalls).toBe(true);
    expect(result.output).toContain('Mathematics');
    expect(result.output).not.toContain('Advanced');
    expect(result.output).toContain('Elementary');
    expect(result.output).toContain('positiveCreditLevels');
    expect(result.followUpInstructions).toContain(
      'These levels do not confirm eligibility for every individual course',
    );
  });

  it('omits level names from an ordinary wallet lookup', async () => {
    const gateway = new ToolGateway(
      [
        createGetMyWalletTool(async () => ({
          status: 'available',
          wallet: [
            { creditName: 'Mathematics', level: 'Elementary', amount: 4 },
          ],
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';

    const result = await gateway.execute(call, 'get_my_wallet', '{}');

    expect(JSON.parse(result.output)).toEqual({
      status: 'available',
      wallet: [{ bundleName: 'Mathematics', credits: 4 }],
    });
    expect(result.output).not.toContain('Elementary');
    expect(result.followUpInstructions).toContain(
      'Do not reveal level or levelName',
    );
  });

  it('marks positive-credit levels incomplete when an entry has no level', async () => {
    const gateway = new ToolGateway(
      [
        createGetMyWalletTool(async () => ({
          status: 'available',
          wallet: [
            { creditName: 'Known', level: 'Intermediate', amount: 3 },
            { creditName: 'Unclassified', amount: 1 },
          ],
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';

    const result = await gateway.execute(
      call,
      'get_my_wallet',
      JSON.stringify({ includeCourseAccessLevels: true }),
    );

    expect(JSON.parse(result.output)).toMatchObject({
      positiveCreditLevels: ['Intermediate'],
      positiveCreditLevelsComplete: false,
    });
    expect(result.followUpInstructions).toContain(
      'say the complete level list could not be confirmed and label any returned levels as partial',
    );
  });

  it('requires verification before retrieving wallet hours', async () => {
    const getMyWallet = vi.fn(async () => ({
      status: 'available' as const,
      wallet: [{ creditName: 'Elementary', amount: 1 }],
    }));
    const gateway = new ToolGateway(
      [createGetMyWalletTool(getMyWallet)],
      { record: async () => undefined },
      logger,
    );

    const result = await gateway.execute(context(false), 'get_my_wallet', '{}');

    expect(JSON.parse(result.output)).toMatchObject({
      error: 'denied',
      reason: 'ACCOUNT_NOT_VERIFIED',
    });
    expect(getMyWallet).not.toHaveBeenCalled();
  });

  it('does not claim the wallet has no credits when lookup is unavailable', async () => {
    const gateway = new ToolGateway(
      [
        createGetMyWalletTool(async () => ({
          status: 'unavailable',
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';

    const result = await gateway.execute(call, 'get_my_wallet', '{}');

    expect(JSON.parse(result.output)).toEqual({ status: 'unavailable' });
    expect(result.followUpInstructions).toContain(
      'Do not claim there are no credits',
    );
  });
});

describe('subject catalog and eligibility tools', () => {
  it('resolves subjects from the live catalog using only returned IDs', async () => {
    const getSubjects = vi.fn(async () => ({
      status: 'available' as const,
      subjects: [{ label: 'Math', value: '6a0dfa75b' }],
    }));
    const gateway = new ToolGateway(
      [createGetSubjectsTool(getSubjects)],
      { record: async () => undefined },
      logger,
    );

    const result = await gateway.execute(context(false), 'get_subjects', '{}');

    expect(getSubjects).toHaveBeenCalledOnce();
    expect(JSON.parse(result.output)).toEqual({
      status: 'available',
      subjects: [{ label: 'Math', value: '6a0dfa75b' }],
    });
    expect(result.followUpInstructions).toContain(
      'Treat courses in this catalog as subjects',
    );
    expect(result.followUpInstructions).toContain(
      'Do not ask for verification for a catalog-only question',
    );
    expect(result.followUpInstructions).toContain(
      'Do not send the caller to the website',
    );
    expect(result.followUpInstructions).toContain(
      'if request_member_id and verify_member_id are listed, call request_member_id',
    );
    expect(result.followUpInstructions).toContain(
      'A hidden protected tool is not unavailable',
    );
    expect(result.allowToolCalls).toBe(true);
  });

  it('checks a verified caller’s subject eligibility with the server-held token', async () => {
    const checkEligibility = vi.fn(async () => ({
      status: 'eligible' as const,
      subjectId: '6a0dfa75b',
      subjectName: 'Mathematics',
      levelId: 'level-1',
      levelName: 'Elementary',
      wallet: [{ bundleName: 'Tech Group', credits: 4 }],
    }));
    const gateway = new ToolGateway(
      [createCheckSubjectEligibilityTool(checkEligibility)],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';

    const result = await gateway.execute(
      call,
      'check_subject_eligibility',
      JSON.stringify({ subjectName: 'Mathematics' }),
    );

    expect(checkEligibility).toHaveBeenCalledWith(
      'server-only-token',
      'Mathematics',
    );
    expect(JSON.parse(result.output)).toEqual({
      status: 'eligible',
      subjectName: 'Mathematics',
      wallet: [{ bundleName: 'Tech Group', credits: 4 }],
      subjectId: '6a0dfa75b',
      levelId: 'level-1',
    });
    expect(result.followUpInstructions).toContain(
      'report the returned bundle names and credits',
    );
    expect(result.followUpInstructions).toContain(
      'immediately call find_booking_tutors with this result’s exact subjectId and levelId',
    );
    expect(result.allowToolCalls).toBe(true);
    expect(result.output).not.toContain('Elementary');
    expect(result.output).not.toContain('server-only-token');
  });

  it('allows successful booking catalog lookups to continue the booking flow', async () => {
    const levelGateway = new ToolGateway(
      [
        createGetBookingLevelsTool(async () => ({
          status: 'available',
          entries: [{ id: 'level-1', name: 'Grade 8' }],
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const levels = await levelGateway.execute(
      context(false),
      'get_booking_levels',
      '{}',
    );

    expect(JSON.parse(levels.output)).toEqual({
      status: 'available',
      levels: [{ id: 'level-1', name: 'Grade 8' }],
    });
    expect(levels.allowToolCalls).toBe(true);

    const subjectGateway = new ToolGateway(
      [
        createGetBookingSubjectsTool(async (_token, levelId) => ({
          status: 'available',
          entries: [{ id: `${levelId}-subject`, name: 'Mathematics' }],
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';
    const subjects = await subjectGateway.execute(
      call,
      'get_booking_subjects',
      JSON.stringify({ levelId: 'level-1' }),
    );

    expect(JSON.parse(subjects.output)).toEqual({
      status: 'available',
      subjects: [{ id: 'level-1-subject', name: 'Mathematics' }],
    });
    expect(subjects.allowToolCalls).toBe(true);
  });

  it('reports ineligibility once and waits for an explicit recommendation request', async () => {
    const checkEligibility = vi.fn(async () => ({
      status: 'not_eligible' as const,
      subjectId: '6a0dfa75b',
      subjectName: 'Mathematics',
      wallet: [{ bundleName: 'Tech Group', credits: 4 }],
      recommendedBundles: [
        {
          name: 'Language Group Master',
          price: 10110,
          credits: [
            {
              creditName: 'Language Group',
              amount: 15,
              levelName: 'Languages',
            },
          ],
        },
      ],
    }));
    const gateway = new ToolGateway(
      [createCheckSubjectEligibilityTool(checkEligibility)],
      { record: async () => undefined },
      logger,
    );
    const call = context(true);
    call.serverAccessToken = 'server-only-token';

    const result = await gateway.execute(
      call,
      'check_subject_eligibility',
      JSON.stringify({ subjectName: 'Mathematics' }),
    );

    expect(JSON.parse(result.output)).toEqual({
      status: 'not_eligible',
      subjectName: 'Mathematics',
    });
    expect(result.followUpInstructions).toContain(
      'Your current wallet does not cover the Mathematics course',
    );
    expect(result.allowToolCalls).toBeFalsy();
    expect(result.output).not.toContain('Language Group Master');
    expect(result.output).not.toContain('Languages');
    expect(result.output).not.toContain('"bundleName":"Tech Group"');
    expect(result.output).not.toContain('"credits":4');
    expect(result.output).not.toContain('server-only-token');
  });

  it('requires verification and a valid course name before checking eligibility', async () => {
    const checkEligibility = vi.fn(async () => ({
      status: 'eligible' as const,
      subjectId: '6a0dfa75b',
      subjectName: 'Mathematics',
      levelId: 'level-1',
      levelName: 'Elementary',
      wallet: [{ bundleName: 'Tech Group', credits: 4 }],
    }));
    const gateway = new ToolGateway(
      [createCheckSubjectEligibilityTool(checkEligibility)],
      { record: async () => undefined },
      logger,
    );
    const denied = await gateway.execute(
      context(false),
      'check_subject_eligibility',
      JSON.stringify({ subjectName: 'Mathematics' }),
    );
    const invalid = await gateway.execute(
      context(true),
      'check_subject_eligibility',
      JSON.stringify({ subjectName: '' }),
    );

    expect(JSON.parse(denied.output)).toMatchObject({
      error: 'denied',
      reason: 'ACCOUNT_NOT_VERIFIED',
    });
    expect(JSON.parse(invalid.output)).toMatchObject({
      error: 'denied',
      reason: 'INVALID_ARGUMENTS',
    });
    expect(checkEligibility).not.toHaveBeenCalled();

    const unavailableGateway = new ToolGateway(
      [
        createCheckSubjectEligibilityTool(async () => ({
          status: 'unavailable' as const,
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const verifiedCall = context(true);
    verifiedCall.serverAccessToken = 'server-only-token';
    const unavailable = await unavailableGateway.execute(
      verifiedCall,
      'check_subject_eligibility',
      JSON.stringify({ subjectName: 'Mathematics' }),
    );

    expect(unavailable.followUpInstructions).toContain(
      'could not confirm whether the caller’s wallet covers this subject right now',
    );
    expect(unavailable.followUpInstructions).toContain(
      'Do not offer a callback for this single lookup',
    );
  });
});

describe('audit records and failures', () => {
  it('records every decision with arguments stripped of personal data', async () => {
    const entries: ToolInvocationEntry[] = [];
    const t = createGateway(async (entry) => void entries.push(entry));
    const call = context(true);
    await t.gateway.execute(
      call,
      'escalate_to_human',
      JSON.stringify({
        reason: 'complaint',
        summary: 'My son Ali is struggling',
        contactConsent: true,
      }),
    );
    await t.gateway.execute(context(false), 'end_call', '{}');
    await Promise.resolve();

    expect(entries.map((entry) => [entry.tool, entry.decision])).toEqual([
      ['escalate_to_human', 'allowed'],
      ['end_call', 'allowed'],
    ]);
    expect(entries[1]).toMatchObject({
      tool: 'end_call',
      argsRedacted: {},
    });
    const text = JSON.stringify(entries);
    for (const secret of ['+966500000000', 'parent@example.com', 'Ali']) {
      expect(text).not.toContain(secret);
    }
    expect(entries[0]).toMatchObject({
      sessionId: 's1',
      argsRedacted: { reason: 'complaint', contactConsent: true },
    });
  });

  it('keeps the call going when an audit record cannot be written', async () => {
    const t = createGateway(async () => {
      throw new Error('database is down');
    });
    const result = await t.gateway.execute(
      context(false),
      'search_knowledge',
      JSON.stringify({ query: 'q', language: 'en' }),
    );

    expect(JSON.parse(result.output)).toMatchObject({ found: true });
  });

  it('returns a safe failure to the model when a tool throws', async () => {
    const t = createGateway();
    t.retriever.search.mockRejectedValue(new Error('vector index offline'));
    const result = await t.gateway.execute(
      context(false),
      'search_knowledge',
      JSON.stringify({ query: 'q', language: 'en' }),
    );

    expect(JSON.parse(result.output)).toEqual({ error: 'TOOL_FAILED' });
    expect(result.output).not.toContain('vector index');
    expect(result.followUpInstructions).toContain(
      'The knowledge lookup failed.',
    );
    expect(result.followUpInstructions).toContain('Do not answer from memory');
  });

  it('gives explicit safe guidance when escalation creation fails', async () => {
    const t = createGateway();
    t.escalations.createFromVoiceSession.mockRejectedValue(
      new Error('database is down'),
    );
    const result = await t.gateway.execute(
      context(false),
      'escalate_to_human',
      JSON.stringify({
        reason: 'user_requested',
        summary: 'Caller needs registration help.',
        contactConsent: true,
      }),
    );

    expect(JSON.parse(result.output)).toEqual({ error: 'TOOL_FAILED' });
    expect(result.followUpInstructions).toContain(
      'I couldn’t send your follow-up request just now.',
    );
    expect(result.followUpInstructions).toContain(
      'do not say it was denied or rejected by the team',
    );
    expect(result.followUpInstructions).toContain(
      'do not ask for contact details again',
    );
    expect(result.output).not.toContain('database is down');
  });

  it.each(['en', 'fr', 'ar-SA'] as const)(
    'localizes denial instructions for %s',
    async (locale) => {
      const { gateway } = createGateway();
      const call = context(false, locale);
      const result = await gateway.execute(call, 'not_a_tool', '{}');

      expect(JSON.parse(result.output)).toEqual({
        error: 'denied',
        reason: 'UNKNOWN_TOOL',
      });
      expect(result.followUpInstructions).toBeTruthy();
      expect(result.followUpInstructions).toContain(
        locale === 'en'
          ? 'not available in the current call'
          : locale === 'fr'
            ? 'pas disponible pendant cet appel'
            : 'غير متاحة في المكالمة الحالية',
      );
    },
  );
});
