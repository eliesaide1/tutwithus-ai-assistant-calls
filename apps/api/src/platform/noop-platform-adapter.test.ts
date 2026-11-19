import { describe, expect, it } from 'vitest';
import { NoopPlatformAdapter } from './noop-platform-adapter.js';

describe('NoopPlatformAdapter', () => {
  it('clearly reports that live tutor availability is not configured', async () => {
    const adapter = new NoopPlatformAdapter();

    await expect(
      adapter.findTutorAvailability({
        course: 'mathematics',
        staffId: 'staff-123',
        teachingLanguage: 'ar-SA',
        from: '2026-11-05T09:00:00.000Z',
        to: '2026-11-12T17:00:00.000Z',
        timeZone: 'Asia/Riyadh',
      }),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'platform_not_configured',
    });
  });
});
