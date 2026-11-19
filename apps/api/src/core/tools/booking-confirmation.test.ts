import { describe, expect, it, vi, afterEach } from 'vitest';
import { BookingConfirmation } from './booking-confirmation.js';
const args = {
  levelId: 'l',
  subjectId: 's',
  tutorId: 't',
  date: '2026-12-01',
  timeFrom: '10:00',
  timeTo: '11:00',
  timeZone: 'Asia/Beirut',
};
function setup() {
  const guard = new BookingConfirmation();
  guard.remember('call', args, {
    status: 'available',
    subjectName: 'Backend',
    tutor: { id: 't', name: 'Taylor Tutor' },
    timeZone: args.timeZone,
    slots: [args],
  });
  return guard;
}
afterEach(() => vi.useRealTimers());
describe('booking confirmation boundary', () => {
  it('requires an offered slot, preparation and a new caller confirmation', () => {
    const guard = setup();
    guard.observe('call', 'yes');
    expect(guard.prepare('call', { ...args, tutorId: 'invented' })).toBe(
      undefined,
    );
    expect(guard.prepare('call', args)).toBe(
      'Backend session with Taylor Tutor',
    );
    expect(guard.consume('call', args)).toBe(undefined);
    guard.observe('call', 'yes');
    expect(guard.consume('call', { ...args, timeFrom: '09:00' })).toBe(
      'Backend session with Taylor Tutor',
    );
    expect(guard.consume('call', args)).toBe(undefined);
  });
  it('keeps the prepared description when the final tool paraphrases it', () => {
    const guard = setup();
    const prepared = { ...args, description: 'Backend authentication help' };
    expect(guard.prepare('call', prepared)).toBe('Backend authentication help');
    guard.observe('call', 'yes');
    expect(
      guard.consume('call', {
        ...prepared,
        description: 'A different unconfirmed topic',
      }),
    ).toBe('Backend authentication help');
  });
  it('returns the server-preserved slot after confirmation even if final model arguments drift', () => {
    const guard = setup();
    guard.prepare('call', args);
    guard.observe('call', 'confirm');

    expect(
      guard.consumePrepared('call', {
        ...args,
        tutorId: 'invented',
        timeFrom: '09:00',
      }),
    ).toEqual({
      description: 'Backend session with Taylor Tutor',
      selection: args,
    });
  });
  it('uses the subject-and-tutor default when the caller has no note', () => {
    const guard = setup();
    expect(guard.prepare('call', args)).toBe(
      'Backend session with Taylor Tutor',
    );
    guard.observe('call', 'yes');
    expect(guard.consume('call', args)).toBe(
      'Backend session with Taylor Tutor',
    );
  });
  it.each(['no', 'yes but tomorrow', 'oui mais à midi', 'لا'])(
    'rejects ambiguous or negative confirmation: %s',
    (answer) => {
      const guard = setup();
      guard.prepare('call', args);
      guard.observe('call', answer);
      expect(guard.consume('call', args)).toBe(undefined);
    },
  );
  it.each([
    'yes',
    'yes proceed',
    'confirmed proceed',
    'Confirmed, proceed.',
    'oui',
    'نعم',
  ])('accepts explicit multilingual confirmation: %s', (answer) => {
    const guard = setup();
    guard.prepare('call', args);
    guard.observe('call', answer);
    expect(guard.consume('call', args)).toBe(
      'Backend session with Taylor Tutor',
    );
  });
  it('expires offers and isolates calls', () => {
    vi.useFakeTimers();
    const guard = setup();
    guard.prepare('call', args);
    guard.observe('other', 'yes');
    expect(guard.consume('call', args)).toBe(undefined);
    guard.observe('call', 'yes');
    vi.advanceTimersByTime(300_001);
    expect(guard.consume('call', args)).toBe(undefined);
  });
});
