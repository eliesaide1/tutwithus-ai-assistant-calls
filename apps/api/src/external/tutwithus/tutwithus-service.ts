import type { Locale } from '@tutwithus/contracts';
import type { Logger } from '../../lib/logger.js';
import type { CustomerDirectory } from '../../platform/customer-directory.js';
import {
  checkSubjectEligibility,
  getMyBootcamps,
  getMyTutorAvailability,
  getMyWallet,
  getSubjects,
  loginMember,
  queryBackend,
  recommendCourseBundles,
  searchTutorProfiles,
  type TutWithUsBackendOptions,
  type TutorProfileSearch,
} from './customer.js';
import {
  cancelTutWithUsCourse,
  createTutWithUsCourse,
  findBookingTutors,
  getBookingLevels,
  getBookingSubjects,
  getCourses,
  getTutorBookingAvailability,
  getUpcomingCourses,
  type CourseListFilter,
  type CreateCourseInput,
} from './booking.js';

export type TutWithUsServiceOptions = {
  baseUrl: string;
  timeoutMs: number;
  authLoginPath?: string;
  lookupPath?: string;
};

// Direct adapter for the external TutWithUs API. It replaces the standalone
// service process while keeping credentials and response parsing server-side.
export class TutWithUsService implements CustomerDirectory {
  private readonly backend: TutWithUsBackendOptions;

  constructor(
    options: TutWithUsServiceOptions,
    private readonly logger: Logger,
  ) {
    this.backend = {
      id: 'tutwithus',
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      ...(options.authLoginPath
        ? { authLoginPath: options.authLoginPath }
        : {}),
      ...(options.lookupPath ? { lookupPath: options.lookupPath } : {}),
    };
  }

  lookup(query: { phone: string }) {
    return queryBackend(this.backend, query);
  }

  loginMember(query: { phone: string; memberId: string }) {
    return loginMember(this.backend, query, this.logger);
  }

  getSubjects() {
    return getSubjects(this.backend, this.logger);
  }

  searchTutorProfiles(query: TutorProfileSearch) {
    return searchTutorProfiles(this.backend, query, this.logger);
  }

  checkSubjectEligibility(accessToken: string, subjectName: string) {
    return checkSubjectEligibility(
      this.backend,
      accessToken,
      subjectName,
      this.logger,
    );
  }

  recommendCourseBundles(subjectName: string) {
    return recommendCourseBundles(this.backend, subjectName, this.logger);
  }

  getMyBootcamps(accessToken: string) {
    return getMyBootcamps(this.backend, accessToken, this.logger);
  }

  getMyWallet(accessToken: string) {
    return getMyWallet(this.backend, accessToken, this.logger);
  }

  getMyTutorAvailability(accessToken: string, timeZone: string) {
    return getMyTutorAvailability(
      this.backend,
      accessToken,
      timeZone,
      this.logger,
    );
  }

  getBookingLevels() {
    return getBookingLevels(this.backend, this.logger);
  }

  getBookingSubjects(accessToken: string, levelId: string) {
    return getBookingSubjects(this.backend, accessToken, levelId, this.logger);
  }

  findBookingTutors(
    accessToken: string,
    input: {
      subjectId: string;
      levelId: string;
      curriculum?: string;
      locale: Locale;
    },
  ) {
    return findBookingTutors(this.backend, accessToken, input, this.logger);
  }

  getTutorBookingAvailability(
    accessToken: string,
    input: {
      tutorId: string;
      fromDate: string;
      toDate: string;
      timeZone: string;
    },
  ) {
    return getTutorBookingAvailability(
      this.backend,
      accessToken,
      input,
      this.logger,
    );
  }

  createCourse(accessToken: string, input: CreateCourseInput) {
    return createTutWithUsCourse(this.backend, accessToken, input, this.logger);
  }

  getUpcomingCourses(accessToken: string) {
    return getUpcomingCourses(
      this.backend,
      accessToken,
      new Date(),
      this.logger,
    );
  }

  getCourses(accessToken: string, filter: CourseListFilter) {
    return getCourses(
      this.backend,
      accessToken,
      filter,
      new Date(),
      this.logger,
    );
  }

  cancelCourse(accessToken: string, courseId: string) {
    return cancelTutWithUsCourse(
      this.backend,
      accessToken,
      courseId,
      this.logger,
    );
  }
}
