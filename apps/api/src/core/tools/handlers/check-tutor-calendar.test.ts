import { expect, it, vi } from 'vitest';
import { createCheckTutorCalendarTool } from './voice-tools.js';

const context = {
  sessionId: 'calendar-call',
  locale: 'en' as const,
  timeZone: 'Asia/Beirut',
  callsMade: 0,
  retrieval: { topK: 3, minScore: 0.5 },
  responseExpectation: '',
  serverAccessToken: 'server-token',
};

it('compares tutors, selects the earliest calendar, and limits spoken slots', async () => {
  const getAvailability = vi.fn(
    async (_token: string, input: { tutorId: string }) => ({
      status: 'available' as const,
      slots:
        input.tutorId === 'alice-id'
          ? [{ date: '2026-11-25', timeFrom: '09:00', timeTo: '10:00' }]
          : [
              { date: '2026-11-21', timeFrom: '14:00', timeTo: '15:00' },
              { date: '2026-11-21', timeFrom: '09:00', timeTo: '10:00' },
              { date: '2026-11-21', timeFrom: '10:00', timeTo: '11:00' },
              { date: '2026-11-21', timeFrom: '11:00', timeTo: '12:00' },
              { date: '2026-11-21', timeFrom: '12:00', timeTo: '13:00' },
              { date: '2026-11-23', timeFrom: '09:00', timeTo: '10:00' },
            ],
    }),
  );
  const tool = createCheckTutorCalendarTool(getAvailability);

  expect(
    await tool.invoke(
      {
        tutors: [
          { tutorId: 'alice-id', tutorName: 'Alice Tutor' },
          { tutorId: 'zeina-id', tutorName: 'Zeina Tutor' },
        ],
      },
      context,
    ),
  ).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'available',
        tutorName: 'Zeina Tutor',
        date: '2026-11-21',
        slots: [
          { spokenTime: '9 A.M. to 10 A.M.' },
          { spokenTime: '10 A.M. to 11 A.M.' },
          { spokenTime: '11 A.M. to noon' },
          { spokenTime: 'noon to 1 P.M.' },
        ],
        moreSlotsOnDate: true,
        laterDatesAvailable: true,
      },
    },
  });
  expect(getAvailability).toHaveBeenCalledTimes(2);
  expect(getAvailability).toHaveBeenCalledWith(
    'server-token',
    expect.objectContaining({ timeZone: 'Asia/Beirut' }),
  );
});

it('preserves the exact returned name for one selected tutor', async () => {
  const tool = createCheckTutorCalendarTool(async () => ({
    status: 'available',
    slots: [{ date: '2026-11-21', timeFrom: '09:00', timeTo: '10:00' }],
  }));

  expect(
    await tool.invoke(
      { tutorId: 'zeina-id', tutorName: 'Zeina Al Ahmadieh' },
      context,
    ),
  ).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        tutorName: 'Zeina Al Ahmadieh',
      },
    },
  });
});

it('prepares exact, natural Saudi Arabic availability wording', async () => {
  const tool = createCheckTutorCalendarTool(async () => ({
    status: 'available',
    slots: [
      { date: '2026-11-29', timeFrom: '11:30', timeTo: '12:00' },
      { date: '2026-11-29', timeFrom: '12:00', timeTo: '13:00' },
    ],
  }));

  expect(
    await tool.invoke(
      { tutorId: 'elie-id', tutorName: 'Elie Saide' },
      { ...context, locale: 'ar-SA' },
    ),
  ).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        tutorName: 'Elie Saide',
        date: '2026-11-29',
        spokenDate: 'الأحد، ٢٩ نوفمبر',
        slots: [
          {
            spokenTime: 'من الساعة ١١ ونص الصباح إلى الساعة ١٢ الظهر',
          },
          {
            spokenTime: 'من الساعة ١٢ الظهر إلى الساعة ١ الظهر',
          },
        ],
        spokenSummary:
          'المواعيد المتاحة مع Elie Saide يوم الأحد، ٢٩ نوفمبر: من الساعة ١١ ونص الصباح إلى الساعة ١٢ الظهر، من الساعة ١٢ الظهر إلى الساعة ١ الظهر.',
      },
      followUpInstructions: expect.stringContaining(
        'Say the returned spokenSummary exactly once',
      ),
    },
  });
});
