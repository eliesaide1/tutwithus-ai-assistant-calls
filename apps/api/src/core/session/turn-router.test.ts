import { describe, expect, it } from 'vitest';
import {
  routeCallerTurn,
  type TurnServerState,
  type TurnSignals,
} from './turn-router.js';

const state = (overrides: Partial<TurnServerState> = {}): TurnServerState => ({
  verified: true,
  verificationAvailable: false,
  memberIdAlreadyRequested: false,
  bookingStage: 'idle',
  hasResolvedSubject: true,
  tools: new Set([
    'check_tutor_calendar',
    'search_tutor_profiles',
    'check_subject_eligibility',
    'recommend_course_bundle',
    'get_my_wallet',
  ]),
  ...overrides,
});

const signals = (overrides: Partial<TurnSignals> = {}): TurnSignals => ({
  cancellationConfirmed: false,
  cancellationRequested: false,
  bookingConfirmed: false,
  protectedActionRequested: false,
  tutorCalendarRequested: false,
  tutorProfilesRequested: false,
  namedBookingRequested: false,
  eligibilityRequested: false,
  bundleRequested: false,
  bundleAnyLevel: false,
  ...overrides,
});

describe('deterministic turn router', () => {
  it('routes a verified calendar request without considering verification', () => {
    expect(
      routeCallerTurn(state(), signals({ tutorCalendarRequested: true })),
    ).toEqual({ kind: 'check_tutor_calendar' });
  });

  it('routes an unverified calendar request to the configured verification flow', () => {
    expect(
      routeCallerTurn(
        state({
          verified: false,
          verificationAvailable: true,
          tools: new Set(['request_member_id']),
        }),
        signals({ tutorCalendarRequested: true }),
      ),
    ).toEqual({ kind: 'request_member_id' });
  });

  it('selects only one owner when multiple signals overlap', () => {
    expect(
      routeCallerTurn(
        state(),
        signals({
          tutorCalendarRequested: true,
          tutorProfilesRequested: true,
          bundleRequested: true,
          accountLookup: 'get_my_wallet',
        }),
      ),
    ).toEqual({ kind: 'check_tutor_calendar' });
  });

  it('does not let a bundle change affect eligibility routing', () => {
    expect(
      routeCallerTurn(
        state(),
        signals({ eligibilityRequested: true, bundleRequested: true }),
      ),
    ).toEqual({ kind: 'check_subject_eligibility' });
  });
});
