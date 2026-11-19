export type AccountLookupTool = 'get_my_wallet' | 'get_my_bootcamps';

export type TurnRoute =
  | { kind: 'none' }
  | { kind: 'request_member_id' }
  | { kind: 'cancel_course' }
  | { kind: 'list_courses_for_cancellation' }
  | { kind: 'book_course' }
  | { kind: 'check_tutor_calendar' }
  | { kind: 'unverified_tutor_calendar' }
  | { kind: 'search_tutor_profiles' }
  | { kind: 'start_course_booking' }
  | { kind: 'check_subject_eligibility' }
  | { kind: 'account_lookup'; tool: AccountLookupTool }
  | {
      kind: 'recommend_course_bundle';
      levelName?: string;
      anyLevel: boolean;
    };

export type TurnSignals = {
  cancellationConfirmed: boolean;
  cancellationRequested: boolean;
  bookingConfirmed: boolean;
  protectedActionRequested: boolean;
  tutorCalendarRequested: boolean;
  tutorProfilesRequested: boolean;
  namedBookingRequested: boolean;
  eligibilityRequested: boolean;
  accountLookup?: AccountLookupTool;
  bundleRequested: boolean;
  bundleLevelName?: string;
  bundleAnyLevel: boolean;
};

export type TurnServerState = {
  verified: boolean;
  verificationAvailable: boolean;
  memberIdAlreadyRequested: boolean;
  bookingStage: 'idle' | 'slots_offered' | 'awaiting_confirmation';
  hasResolvedSubject: boolean;
  tools: ReadonlySet<string>;
};

const has = (state: TurnServerState, tool: string) => state.tools.has(tool);

// This is the single authority for choosing the workflow that owns a caller
// turn. It deliberately returns one route, so unrelated tool instructions can
// never compete in the same response.
export function routeCallerTurn(
  state: TurnServerState,
  signals: TurnSignals,
): TurnRoute {
  if (signals.cancellationConfirmed && has(state, 'cancel_course')) {
    return { kind: 'cancel_course' };
  }
  if (
    state.verified &&
    signals.cancellationRequested &&
    has(state, 'get_my_courses')
  ) {
    return { kind: 'list_courses_for_cancellation' };
  }
  if (
    state.bookingStage === 'awaiting_confirmation' &&
    signals.bookingConfirmed &&
    has(state, 'book_course')
  ) {
    return { kind: 'book_course' };
  }
  if (
    !state.verified &&
    signals.protectedActionRequested &&
    !state.memberIdAlreadyRequested &&
    state.verificationAvailable &&
    has(state, 'request_member_id')
  ) {
    return { kind: 'request_member_id' };
  }
  if (signals.tutorCalendarRequested) {
    if (state.verified && has(state, 'check_tutor_calendar')) {
      return { kind: 'check_tutor_calendar' };
    }
    if (
      !state.verified &&
      state.verificationAvailable &&
      has(state, 'request_member_id')
    ) {
      return { kind: 'request_member_id' };
    }
    return { kind: 'unverified_tutor_calendar' };
  }
  if (signals.tutorProfilesRequested && has(state, 'search_tutor_profiles')) {
    return { kind: 'search_tutor_profiles' };
  }
  if (
    state.verified &&
    signals.namedBookingRequested &&
    has(state, 'start_course_booking')
  ) {
    return { kind: 'start_course_booking' };
  }
  if (
    state.verified &&
    signals.eligibilityRequested &&
    has(state, 'check_subject_eligibility')
  ) {
    return { kind: 'check_subject_eligibility' };
  }
  if (
    state.verified &&
    signals.accountLookup &&
    has(state, signals.accountLookup)
  ) {
    return { kind: 'account_lookup', tool: signals.accountLookup };
  }
  if (
    state.hasResolvedSubject &&
    signals.bundleRequested &&
    has(state, 'recommend_course_bundle')
  ) {
    return {
      kind: 'recommend_course_bundle',
      ...(signals.bundleLevelName
        ? { levelName: signals.bundleLevelName }
        : {}),
      anyLevel: signals.bundleAnyLevel,
    };
  }
  return { kind: 'none' };
}

export function forcedToolForRoute(route: TurnRoute): string | undefined {
  switch (route.kind) {
    case 'request_member_id':
    case 'cancel_course':
    case 'search_tutor_profiles':
    case 'start_course_booking':
      return route.kind;
    case 'list_courses_for_cancellation':
      return 'get_my_courses';
    case 'account_lookup':
      return route.tool;
    case 'recommend_course_bundle':
      return 'recommend_course_bundle';
    default:
      return undefined;
  }
}
