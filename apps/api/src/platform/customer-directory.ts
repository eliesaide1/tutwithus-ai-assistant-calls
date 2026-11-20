import type { Locale } from '@tutwithus/contracts';
import type {
  BookingAvailabilityResult,
  BookingCatalogResult,
  BookingTutorsResult,
  CreateCourseInput,
  CreateCourseResult,
  UpcomingCoursesResult,
  CancelCourseResult,
  CourseListFilter,
} from '../external/tutwithus/booking.js';

// Read-only view of TutWithUs's registered customers. It answers one question,
// "is this person registered", and returns nothing else about them.
//
// The receptionist never creates or changes customers (PDF section 1: nothing
// writes to the live TutWithUs platform).

export type CustomerLookup = {
  // Required. The caller is identified by their trusted incoming number.
  phone: string;
};

export type CustomerLookupResult =
  | { status: 'registered'; customerId: string }
  | { status: 'not_registered' }
  // The directory is not configured or could not be reached. Never treated as
  // "registered".
  | { status: 'unavailable' };

export type MemberLoginResult =
  | { status: 'verified'; accessToken: string; role: string }
  | { status: 'not_verified' }
  | { status: 'unavailable' };
export type TutorAvailabilityResult =
  { status: 'available'; data: unknown } | { status: 'unavailable' };

export type BootcampResult =
  { status: 'available'; data: unknown } | { status: 'unavailable' };
export type CatalogSubject = {
  label: string;
  value: string;
};
export type SubjectsResult =
  | { status: 'available'; subjects: CatalogSubject[] }
  | { status: 'unavailable' };
export type TutorProfile = {
  id: string;
  fullName: string;
  subjects: string[];
  curriculums: Array<{ label: string; value: string }>;
  profilePic?: string;
  degree?: string;
  school?: string;
  rating?: number;
};
export type TutorProfileSearch = {
  tutorName?: string;
  subjectName?: string;
  curriculum?: string;
};
export type TutorProfilesResult =
  { status: 'available'; profiles: TutorProfile[] } | { status: 'unavailable' };
export type WalletCredit = {
  creditName: string;
  amount: number;
  level?: string;
};
export type WalletResult =
  { status: 'available'; wallet: WalletCredit[] } | { status: 'unavailable' };
export type WalletBundleSummary = {
  bundleName: string;
  credits: number;
};
export type SubjectBundleOption = {
  name: string;
  price: number;
  currency?: string;
  credits: Array<{
    creditName: string;
    amount: number;
    levelName: string;
  }>;
};
export type SubjectEligibilityResult =
  | {
      status: 'eligible';
      subjectId: string;
      subjectName: string;
      levelId: string;
      levelName: string;
      wallet: WalletBundleSummary[];
    }
  | { status: 'invalid_subject'; subjectName: string }
  | {
      status: 'ambiguous_subject';
      subjectName: string;
      candidates: string[];
    }
  | {
      status: 'no_credits';
      subjectName: string;
      wallet: WalletBundleSummary[];
      recommendedBundles?: SubjectBundleOption[];
    }
  | {
      status: 'not_eligible';
      subjectId: string;
      subjectName: string;
      wallet: WalletBundleSummary[];
      recommendedBundles?: SubjectBundleOption[];
    }
  | { status: 'unavailable' };

export interface CustomerDirectory {
  lookup(query: CustomerLookup): Promise<CustomerLookupResult>;
  loginMember?(query: {
    phone: string;
    memberId: string;
  }): Promise<MemberLoginResult>;
  getMyBootcamps?(accessToken: string): Promise<BootcampResult>;
  getMyWallet?(accessToken: string): Promise<WalletResult>;
  getMyTutorAvailability?(
    accessToken: string,
    timeZone: string,
  ): Promise<TutorAvailabilityResult>;
  getSubjects?(): Promise<SubjectsResult>;
  searchTutorProfiles?(query: TutorProfileSearch): Promise<TutorProfilesResult>;
  checkSubjectEligibility?(
    accessToken: string,
    subjectId: string,
  ): Promise<SubjectEligibilityResult>;
  getBookingLevels?(): Promise<BookingCatalogResult>;
  getBookingSubjects?(
    accessToken: string,
    levelId: string,
  ): Promise<BookingCatalogResult>;
  findBookingTutors?(
    accessToken: string,
    input: {
      subjectId: string;
      levelId: string;
      curriculum?: string;
      locale: Locale;
    },
  ): Promise<BookingTutorsResult>;
  getTutorBookingAvailability?(
    accessToken: string,
    input: {
      tutorId: string;
      fromDate: string;
      toDate: string;
      timeZone: string;
    },
  ): Promise<BookingAvailabilityResult>;
  createCourse?(
    accessToken: string,
    input: CreateCourseInput,
  ): Promise<CreateCourseResult>;
  getUpcomingCourses?(accessToken: string): Promise<UpcomingCoursesResult>;
  getCourses?(
    accessToken: string,
    filter: CourseListFilter,
  ): Promise<UpcomingCoursesResult>;
  cancelCourse?(
    accessToken: string,
    courseId: string,
  ): Promise<CancelCourseResult>;
}

// Numbers are stored as "+966 50 000 0000", "0500000000" or "966500000000"
// depending on the system. The database search narrows candidates by the last
// digits; the final decision uses the full international number (below).
const PHONE_MATCH_DIGITS = 9;
const PHONE_MIN_DIGITS = 8;

// Returns the digits used to compare two phone numbers, or undefined when the
// value is too short to identify anyone.
export function phoneMatchKey(value: string): string | undefined {
  const digits = value.replace(/\D/g, '');
  return digits.length >= PHONE_MIN_DIGITS
    ? digits.slice(-PHONE_MATCH_DIGITS)
    : undefined;
}

export const DEFAULT_COUNTRY_CODE = '966';

// Turns a phone number into full international digits (no "+"), or undefined
// when it is too short or too long to be a phone number.
//
// Local numbers ("0500000000", "500000000") are assumed to belong to
// `defaultCountryCode`. A plausible international number containing at least
// ten digits is preserved even when the caller omitted the leading "+". This
// prevents values such as "961..." from becoming "966961...".
export function canonicalPhone(
  value: string,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE,
): string | undefined {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < PHONE_MIN_DIGITS) {
    return undefined;
  }

  let international: string;
  if (trimmed.startsWith('+')) {
    international = digits;
  } else if (digits.startsWith('00')) {
    international = digits.slice(2);
  } else if (digits.startsWith('0')) {
    international = defaultCountryCode + digits.replace(/^0+/, '');
  } else if (
    digits.startsWith(defaultCountryCode) &&
    digits.length >= defaultCountryCode.length + PHONE_MIN_DIGITS
  ) {
    international = digits;
  } else if (digits.length >= 10) {
    international = digits;
  } else {
    international = defaultCountryCode + digits;
  }
  // E.164 allows at most 15 digits.
  return international.length >= PHONE_MIN_DIGITS && international.length <= 15
    ? international
    : undefined;
}

export function maskPhone(value: string): string {
  const canonical = canonicalPhone(value);
  if (!canonical) {
    return '••••';
  }
  return `+${'•'.repeat(Math.max(0, canonical.length - 4))}${canonical.slice(-4)}`;
}

export function phonesMatch(
  left: string,
  right: string,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE,
): boolean {
  const leftPhone = canonicalPhone(left, defaultCountryCode);
  return (
    leftPhone !== undefined &&
    leftPhone === canonicalPhone(right, defaultCountryCode)
  );
}
