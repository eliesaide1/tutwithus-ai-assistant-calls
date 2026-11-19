import type {
  PlatformAdapter,
  TutorAvailabilityQuery,
  TutorAvailabilityResult,
} from './platform-adapter.js';

export class NoopPlatformAdapter implements PlatformAdapter {
  async findTutorAvailability(
    _query: TutorAvailabilityQuery,
  ): Promise<TutorAvailabilityResult> {
    return {
      status: 'unavailable',
      reason: 'platform_not_configured',
    };
  }
}
