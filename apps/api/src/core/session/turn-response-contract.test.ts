import { expect, it } from 'vitest';
import { turnResponseContract } from './turn-response-contract.js';

it('isolates calendar instructions from verification and booking', () => {
  const contract = turnResponseContract({
    route: { kind: 'check_tutor_calendar' },
    tutorProfiles: [{ id: 't1', fullName: 'Tutor One' }],
    locale: 'en',
  });
  expect(contract.toolChoice).toBe('auto');
  expect(contract.instructions).toHaveLength(1);
  expect(contract.instructions[0]).toContain('check_tutor_calendar');
  expect(contract.instructions[0]).not.toContain('book_course');
  expect(contract.instructions[0]).not.toContain('request_member_id');
});

it('uses a fixed natural Saudi waiting sentence for Arabic calendar lookups', () => {
  const contract = turnResponseContract({
    route: { kind: 'check_tutor_calendar' },
    tutorProfiles: [{ id: 't1', fullName: 'Elie Saide' }],
    locale: 'ar-SA',
  });

  expect(contract.instructions[0]).toContain(
    'أكيد، أشيك لك على المواعيد المتاحة الحين.',
  );
  expect(contract.instructions[0]).toContain('Do not add filler');
});

it('keeps booking success conditional on the backend result', () => {
  const contract = turnResponseContract({
    route: { kind: 'book_course' },
    tutorProfiles: [],
    locale: 'en',
  });
  expect(contract.toolChoice).toBe('auto');
  expect(contract.instructions[0]).toContain(
    'only when the result status is booked',
  );
});
