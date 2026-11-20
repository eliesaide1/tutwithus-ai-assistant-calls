import { expect, it } from 'vitest';
import { ConversationContext } from './conversation-context.js';

it('preserves structured references across tool workflows', () => {
  const context = new ConversationContext();
  context.rememberSubject(' Math ');
  context.rememberTutors([{ id: 't1', fullName: 'Tutor One' }]);
  context.requireBundleLevel('Math', ['Elementary', 'Middle']);
  context.bookingStage = 'slots_offered';
  context.rememberTutorCalendarDate('2026-11-29');
  context.pendingMoreTutorDates = true;

  expect(context).toMatchObject({
    subjectName: 'Math',
    tutors: [{ id: 't1', fullName: 'Tutor One' }],
    pendingBundleLevel: {
      subjectName: 'Math',
      levels: ['Elementary', 'Middle'],
    },
    bookingStage: 'slots_offered',
    lastTutorCalendarDate: '2026-11-29',
    pendingMoreTutorDates: true,
  });
});
