import { describe, expect, it } from 'vitest';
import { CancellationConfirmation } from './cancellation-confirmation.js';

describe('CancellationConfirmation', () => {
  it.each([
    'yes',
    'yes, confirmed',
    'yes, confirm cancellation',
    'confirmed',
    'confirmed, cancel it',
  ])(
    'automatically prepares one returned session and accepts %s in a new turn',
    (reply) => {
      const confirmation = new CancellationConfirmation();
      confirmation.remember('session', {
        status: 'available',
        courses: [{ id: 'course-1' }],
      });

      confirmation.observe('session', reply);

      expect(confirmation.consume('session', 'course-1')).toBe(true);
    },
  );

  it('requires an explicit selection when multiple sessions are returned', () => {
    const confirmation = new CancellationConfirmation();
    confirmation.remember('session', {
      status: 'available',
      courses: [{ id: 'course-1' }, { id: 'course-2' }],
    });

    confirmation.observe('session', 'yes');
    expect(confirmation.consume('session', 'course-1')).toBe(false);

    expect(confirmation.prepare('session', 'course-2')).toBe(true);
    confirmation.observe('session', 'yes confirmed');
    expect(confirmation.consume('session', 'course-2')).toBe(true);
  });

  it('does not accept a different or unlisted course', () => {
    const confirmation = new CancellationConfirmation();
    confirmation.remember('session', {
      status: 'available',
      courses: [{ id: 'course-1' }],
    });
    confirmation.observe('session', 'yes');

    expect(confirmation.consumePrepared('session', 'course-2')).toBe(
      'course-1',
    );
  });

  it('does not add a redundant preparation step for one session', () => {
    const confirmation = new CancellationConfirmation();
    confirmation.remember('session', {
      status: 'available',
      courses: [{ id: 'course-1' }],
    });

    expect(confirmation.prepare('session', 'course-1')).toBe(false);
    confirmation.observe('session', 'yes');
    expect(confirmation.consume('session', 'course-1')).toBe(true);
  });

  it('allows the controller to atomically confirm a prepared cancellation', () => {
    const confirmation = new CancellationConfirmation();
    confirmation.remember('session', {
      status: 'available',
      courses: [{ id: 'course-1' }],
    });

    expect(confirmation.confirmPending('session')).toBe(true);
    expect(confirmation.consumePrepared('session', 'model-value')).toBe(
      'course-1',
    );
  });
});
