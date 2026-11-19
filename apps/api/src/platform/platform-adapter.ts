import type { Locale } from '@tutwithus/contracts';

export type TutorAvailabilityQuery = {
  course: string;
  staffId?: string;
  teachingLanguage?: Locale;
  from: string;
  to: string;
  timeZone: string;
};

export type TutorAvailabilityMatch = {
  staffId: string;
  displayName: string;
  courses: string[];
  languages: Locale[];
  availableSlots: Array<{
    start: string;
    end: string;
  }>;
};

export type TutorAvailabilityResult =
  | {
      status: 'available';
      matches: TutorAvailabilityMatch[];
    }
  | {
      status: 'unavailable';
      reason: 'platform_not_configured';
    };

export interface PlatformAdapter {
  findTutorAvailability(
    query: TutorAvailabilityQuery,
  ): Promise<TutorAvailabilityResult>;
}
