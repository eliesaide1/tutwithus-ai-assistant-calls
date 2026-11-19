import { afterEach, expect, it, vi } from 'vitest';
import { createCheckTutorAvailabilityTool } from './voice-tools.js';
import type { BookingAvailabilityResult } from '../../../external/tutwithus/booking.js';

afterEach(() => vi.useRealTimers());
const context = {
  sessionId: 'test',
  locale: 'en' as const,
  callsMade: 0,
  retrieval: { topK: 3, minScore: 0.5 },
  responseExpectation: '',
  serverAccessToken: 'token',
};
const args = {
  levelId: 'level',
  subjectId: 'subject',
  tutorPreference: 'nearest',
  preferredDays: [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ],
};
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-15T08:00:00Z'));
  const lookup = vi.fn(
    async (
      _token: string,
      _input: { fromDate: string; toDate: string },
    ): Promise<BookingAvailabilityResult> => ({
      status: 'available',
      slots: [],
    }),
  );
  const tool = createCheckTutorAvailabilityTool({
    findBookingTutors: async () => ({
      status: 'available',
      tutors: [{ id: 'tutor', name: 'Tutor' }],
    }),
    getTutorBookingAvailability: lookup,
  });
  return { tool, lookup };
}
it('terminates an empty search at the 90-day horizon', async () => {
  const { tool, lookup } = setup();
  const result = await tool.invoke(args, context);
  expect(result).toMatchObject({
    kind: 'ok',
    outcome: { output: { status: 'no_matching_slots' } },
  });
  expect(lookup).toHaveBeenCalledTimes(7);
  expect(lookup.mock.calls.at(-1)?.[1].toDate).toBe('2027-02-15');
});
it('reports the exact searched range and asks before expanding weekdays to weekends', async () => {
  const { tool } = setup();
  const result = await tool.invoke(
    {
      ...args,
      preferredDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    },
    context,
  );
  expect(result).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'no_matching_slots',
        searchedFromDate: '2026-11-17',
        searchedThroughDate: '2027-02-15',
        searchedDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      },
      followUpInstructions: expect.stringContaining(
        'ask whether the caller wants weekends included',
      ),
    },
  });
});
it('filters the returned slots to the requested date and time range', async () => {
  const { tool, lookup } = setup();
  lookup.mockResolvedValue({
    status: 'available',
    slots: [
      { date: '2026-11-20', timeFrom: '09:00', timeTo: '10:00' },
      { date: '2026-11-20', timeFrom: '14:00', timeTo: '15:00' },
    ],
  });
  const result = await tool.invoke(
    {
      ...args,
      fromDate: '2026-11-20',
      toDate: '2026-11-20',
      preferredTimeFrom: '13:00',
      preferredTimeTo: '16:00',
    },
    context,
  );
  expect(result).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        date: '2026-11-20',
        weekday: 'Friday',
        slots: [{ date: '2026-11-20', timeFrom: '14:00', timeTo: '15:00' }],
      },
    },
  });
});
it('ignores a model-supplied continuation date without a matching server cursor', async () => {
  const { tool, lookup } = setup();
  await tool.invoke(
    { ...args, searchFromDate: '2027-01-01', toDate: '2026-11-20' },
    context,
  );
  expect(lookup.mock.calls[0]?.[1].fromDate).toBe('2026-11-17');
});
