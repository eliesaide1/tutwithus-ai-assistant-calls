import type { Locale } from '@tutwithus/contracts';
import { errorName, type Logger } from '../../lib/logger.js';
import {
  getLevelsForSubject,
  getMyWallet,
  getSubjects,
  matchWalletToSubjectLevels,
  type TutWithUsBackendOptions,
} from './customer.js';

export type BookingCatalogEntry = { id: string; name: string };
export type BookingTutor = {
  id: string;
  name: string;
  profilePic?: string;
};
export type BookingSlot = {
  date: string;
  timeFrom: string;
  timeTo: string;
};
export type BookingCatalogResult =
  | {
      status: 'available';
      entries: BookingCatalogEntry[];
    }
  | { status: 'unavailable' };
export type BookingTutorsResult =
  | {
      status: 'available';
      tutors: BookingTutor[];
    }
  | { status: 'unavailable' };
export type BookingAvailabilityResult =
  | {
      status: 'available';
      slots: BookingSlot[];
    }
  | { status: 'not_bookable' }
  | { status: 'unavailable' };
export type CreateCourseInput = {
  idempotencyKey?: string;
  levelId: string;
  subjectId: string;
  tutorId: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  timeZone: string;
  description?: string;
  curriculum?: string;
  locale: Locale;
};
export type CreateCourseResult =
  | {
      status: 'booked';
      courseId: string;
      sessionId: string;
      levelName: string;
      subjectName: string;
      tutorName: string;
    }
  | {
      status:
        | 'no_credits'
        | 'not_eligible'
        | 'selection_unavailable'
        | 'slot_unavailable'
        | 'unavailable'
        | 'unknown';
    };
export type UpcomingCourse = {
  id: string;
  subjectName: string;
  tutorName?: string;
  timeFrom: string;
  timeTo: string;
};
export type UpcomingCoursesResult =
  | { status: 'available'; courses: UpcomingCourse[] }
  | { status: 'unavailable' };
export type CourseListFilter = {
  scope: 'upcoming' | 'past';
  fromDate?: string;
  toDate?: string;
};
export type CancelCourseResult =
  | { status: 'cancelled' }
  | { status: 'not_found' | 'already_cancelled' | 'unavailable' };

type JsonResult =
  | { ok: true; statusCode: number; body: unknown }
  | { ok: false; statusCode?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function responseData(body: unknown): unknown {
  return isRecord(body) && 'data' in body ? body.data : body;
}

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;
const cleanCourseSubject = (value: string): string =>
  value.replace(/\s+session\s+with\s+.+$/i, '').trim() || value;
const tutorFromDescription = (value: unknown): string | undefined => {
  const description = nonEmptyString(value);
  return description?.match(/\bsession\s+with\s+(.+)$/i)?.[1]?.trim();
};

export async function getUpcomingCourses(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  now: Date,
  logger?: Logger,
): Promise<UpcomingCoursesResult> {
  return getCourses(backend, accessToken, { scope: 'upcoming' }, now, logger);
}

export async function getCourses(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  filter: CourseListFilter,
  now: Date,
  logger?: Logger,
): Promise<UpcomingCoursesResult> {
  const url = new URL('/courses', backend.baseUrl);
  const result = await requestJson(
    backend,
    url,
    { headers: { authorization: `Bearer ${accessToken}` } },
    logger,
    'TutWithUs upcoming courses lookup',
  );
  if (!result.ok) return { status: 'unavailable' };
  const data = responseData(result.body);
  if (!Array.isArray(data)) return { status: 'unavailable' };
  const courses: UpcomingCourse[] = [];
  for (const item of data) {
    if (!isRecord(item) || item.isCanceled === true) continue;
    const id = nonEmptyString(item._id);
    const timeFrom = nonEmptyString(item.timeFrom);
    const timeTo = nonEmptyString(item.timeTo);
    if (!id || !timeFrom || !timeTo) continue;
    const startsAt = Date.parse(timeFrom);
    const endsAt = Date.parse(timeTo);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) continue;
    if (
      filter.scope === 'upcoming'
        ? startsAt <= now.getTime()
        : endsAt >= now.getTime()
    )
      continue;
    if (
      filter.fromDate &&
      startsAt < Date.parse(`${filter.fromDate}T00:00:00.000Z`)
    )
      continue;
    if (
      filter.toDate &&
      startsAt >= Date.parse(`${filter.toDate}T00:00:00.000Z`) + 86_400_000
    )
      continue;
    const subject = isRecord(item.subjectId) ? item.subjectId : undefined;
    const subjectName = cleanCourseSubject(
      nonEmptyString(subject?.label) ??
        nonEmptyString(subject?.name) ??
        nonEmptyString(item.subjectName) ??
        nonEmptyString(item.description) ??
        'TutWithUs session',
    );
    const tutor = isRecord(item.tutorId) ? item.tutorId : undefined;
    const tutorName =
      nonEmptyString(tutor?.fullName) ??
      nonEmptyString(tutor?.name) ??
      nonEmptyString(item.tutorName) ??
      tutorFromDescription(item.description);
    courses.push({
      id,
      subjectName,
      ...(tutorName ? { tutorName } : {}),
      timeFrom,
      timeTo,
    });
  }
  courses.sort((a, b) => Date.parse(a.timeFrom) - Date.parse(b.timeFrom));
  return { status: 'available', courses };
}

export async function cancelTutWithUsCourse(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  courseId: string,
  logger?: Logger,
): Promise<CancelCourseResult> {
  const url = new URL(
    `/courses/${encodeURIComponent(courseId)}/cancel`,
    backend.baseUrl,
  );
  const result = await requestJson(
    backend,
    url,
    { method: 'PATCH', headers: { authorization: `Bearer ${accessToken}` } },
    logger,
    'TutWithUs course cancellation',
  );
  if (!result.ok) {
    if (result.statusCode === 404) return { status: 'not_found' };
    if (result.statusCode === 409) return { status: 'already_cancelled' };
    return { status: 'unavailable' };
  }
  if (isRecord(result.body) && result.body.error === true)
    return { status: 'unavailable' };
  return { status: 'cancelled' };
}

async function requestJson(
  backend: TutWithUsBackendOptions,
  url: URL,
  init: RequestInit,
  logger: Logger | undefined,
  operation: string,
): Promise<JsonResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), backend.timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: backend.signal
        ? AbortSignal.any([controller.signal, backend.signal])
        : controller.signal,
    });
    if (!response.ok) {
      logger?.warn(
        {
          backend: backend.id,
          method: init.method ?? 'GET',
          path: url.pathname,
          upstreamStatus: response.status,
          outcome: 'unavailable',
          durationMs: Date.now() - startedAt,
        },
        `${operation} failed`,
      );
      return { ok: false, statusCode: response.status };
    }
    const body: unknown = await response.json();
    logger?.info(
      {
        backend: backend.id,
        method: init.method ?? 'GET',
        path: url.pathname,
        upstreamStatus: response.status,
        outcome: 'available',
        durationMs: Date.now() - startedAt,
      },
      `${operation} completed`,
    );
    return { ok: true, statusCode: response.status, body };
  } catch (error) {
    logger?.warn(
      {
        backend: backend.id,
        method: init.method ?? 'GET',
        path: url.pathname,
        outcome: 'unavailable',
        reason: errorName(error),
        durationMs: Date.now() - startedAt,
      },
      `${operation} failed`,
    );
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

function parseActiveCatalog(body: unknown): BookingCatalogEntry[] | undefined {
  const data = responseData(body);
  if (!Array.isArray(data)) {
    return undefined;
  }
  const entries: BookingCatalogEntry[] = [];
  for (const entry of data) {
    const id = isRecord(entry)
      ? typeof entry._id === 'string'
        ? entry._id
        : entry.value
      : undefined;
    const name = isRecord(entry)
      ? typeof entry.name === 'string'
        ? entry.name
        : entry.label
      : undefined;
    if (
      !isRecord(entry) ||
      (entry.isActive !== undefined && typeof entry.isActive !== 'boolean') ||
      typeof id !== 'string' ||
      !id.trim() ||
      typeof name !== 'string' ||
      !name.trim()
    ) {
      return undefined;
    }
    if (entry.isActive !== false) {
      entries.push({ id: id.trim(), name: name.trim() });
    }
  }
  return entries;
}

function parseBookingTutors(
  body: unknown,
  locale: Locale,
): BookingTutor[] | undefined {
  const data = responseData(body);
  if (!Array.isArray(data)) {
    return undefined;
  }
  const tutors: BookingTutor[] = [];
  for (const tutor of data) {
    if (
      !isRecord(tutor) ||
      typeof tutor.isAvailableForBooking !== 'boolean' ||
      typeof tutor._id !== 'string' ||
      !tutor._id.trim()
    ) {
      return undefined;
    }
    if (!tutor.isAvailableForBooking) {
      continue;
    }
    const firstName =
      locale === 'ar-SA' && typeof tutor.firstNameAr === 'string'
        ? tutor.firstNameAr
        : tutor.firstName;
    const lastName =
      locale === 'ar-SA' && typeof tutor.lastNameAr === 'string'
        ? tutor.lastNameAr
        : tutor.lastName;
    if (
      typeof firstName !== 'string' ||
      !firstName.trim() ||
      typeof lastName !== 'string' ||
      !lastName.trim()
    ) {
      return undefined;
    }
    let profilePic: string | undefined;
    if (typeof tutor.profilePic === 'string') {
      try {
        const candidate = new URL(tutor.profilePic.trim());
        if (candidate.protocol === 'https:') profilePic = candidate.toString();
      } catch {
        // A broken optional image must not make the booking tutor list fail.
      }
    }
    tutors.push({
      id: tutor._id.trim(),
      name: `${firstName.trim()} ${lastName.trim()}`,
      ...(profilePic ? { profilePic } : {}),
    });
  }
  return tutors;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatTimeInZone(
  value: string,
  date: string,
  timeZone: string,
): { date: string; time: string } | undefined {
  const hasExplicitOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const timeValue = value.includes('T')
    ? value.slice(value.indexOf('T') + 1)
    : value;
  const localTimeMatch = timeValue.match(
    /^((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/,
  );
  if (!hasExplicitOffset && localTimeMatch) {
    return { date, time: localTimeMatch[1]! };
  }

  if (!hasExplicitOffset) {
    return undefined;
  }
  const timestamp = value.includes('T') ? value : `${date}T${value}`;
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) {
    return undefined;
  }

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}`;
  if (!isDate(localDate) || !isTime(localTime)) {
    return undefined;
  }
  return { date: localDate, time: localTime };
}

function parseAvailableTimes(
  body: unknown,
  timeZone: string,
):
  | { total: number; slots: BookingSlot[]; isAvailableForBooking: boolean }
  | undefined {
  const data = responseData(body);
  if (
    !isRecord(data) ||
    typeof data.isAvailableForBooking !== 'boolean' ||
    !Array.isArray(data.availableTimes)
  ) {
    return undefined;
  }
  if (!data.isAvailableForBooking) {
    return {
      total: data.availableTimes.length,
      slots: [],
      isAvailableForBooking: false,
    };
  }
  const slots: BookingSlot[] = [];
  for (const day of data.availableTimes) {
    if (
      !isRecord(day) ||
      typeof day.date !== 'string' ||
      !isDate(day.date) ||
      typeof day.status !== 'string' ||
      typeof day.isAvailable !== 'boolean' ||
      !Array.isArray(day.timeSlots)
    ) {
      return undefined;
    }
    if (day.status !== 'ACTIVE' || !day.isAvailable) {
      continue;
    }
    for (const timeSlot of day.timeSlots) {
      if (
        !isRecord(timeSlot) ||
        typeof timeSlot.startHour !== 'string' ||
        typeof timeSlot.endHour !== 'string' ||
        typeof timeSlot.isAvailable !== 'boolean'
      ) {
        return undefined;
      }
      const start = formatTimeInZone(timeSlot.startHour, day.date, timeZone);
      const end = formatTimeInZone(timeSlot.endHour, day.date, timeZone);
      if (!start || !end) {
        return undefined;
      }
      if (
        timeSlot.isAvailable &&
        start.date === end.date &&
        end.time > start.time
      ) {
        slots.push({
          date: start.date,
          timeFrom: start.time,
          timeTo: end.time,
        });
      }
    }
  }
  return {
    total: data.availableTimes.length,
    slots,
    isAvailableForBooking: true,
  };
}

function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function localDateTimeToEpoch(
  date: string,
  time: string,
  timeZone: string,
): number | undefined {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const candidates: number[] = [];
  for (
    let sample = target - 36 * 60 * 60_000;
    sample <= target + 36 * 60 * 60_000;
    sample += 3 * 60 * 60_000
  ) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(sample))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day!,
      parts.hour!,
      parts.minute!,
    );
    const candidate = target - (represented - sample);
    const candidateParts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    if (
      candidateParts.year === year &&
      candidateParts.month === month &&
      candidateParts.day === day &&
      candidateParts.hour === hour &&
      candidateParts.minute === minute
    ) {
      candidates.push(candidate);
    }
  }
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

function hasMinimumNotice(slot: BookingSlot, timeZone: string): boolean {
  const start = localDateTimeToEpoch(slot.date, slot.timeFrom, timeZone);
  return start !== undefined && start >= Date.now() + 48 * 60 * 60_000;
}

export async function getBookingLevels(
  backend: TutWithUsBackendOptions,
  logger?: Logger,
): Promise<BookingCatalogResult> {
  const url = new URL('/levels/active', backend.baseUrl);
  const result = await requestJson(
    backend,
    url,
    { method: 'GET' },
    logger,
    'TutWithUs active level lookup',
  );
  const entries = result.ok ? parseActiveCatalog(result.body) : undefined;
  return entries ? { status: 'available', entries } : { status: 'unavailable' };
}

export async function getBookingSubjects(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  levelId: string,
  logger?: Logger,
): Promise<BookingCatalogResult> {
  const url = new URL('/subjects', backend.baseUrl);
  url.searchParams.set('levelId', levelId);
  const result = await requestJson(
    backend,
    url,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
    logger,
    'TutWithUs level subject lookup',
  );
  const entries = result.ok ? parseActiveCatalog(result.body) : undefined;
  return entries ? { status: 'available', entries } : { status: 'unavailable' };
}

export async function findBookingTutors(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  input: {
    subjectId: string;
    levelId: string;
    curriculum?: string;
    locale: Locale;
  },
  logger?: Logger,
): Promise<BookingTutorsResult> {
  const url = new URL('/tutors/profiles/booking', backend.baseUrl);
  url.searchParams.set('subjectId', input.subjectId);
  url.searchParams.set('levelId', input.levelId);
  if (input.curriculum) {
    url.searchParams.set('curriculum', input.curriculum);
  }
  const result = await requestJson(
    backend,
    url,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
    logger,
    'TutWithUs booking tutor lookup',
  );
  const tutors = result.ok
    ? parseBookingTutors(result.body, input.locale)
    : undefined;
  return tutors ? { status: 'available', tutors } : { status: 'unavailable' };
}

export async function getTutorBookingAvailability(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  input: {
    tutorId: string;
    fromDate: string;
    toDate: string;
    timeZone: string;
  },
  logger?: Logger,
): Promise<BookingAvailabilityResult> {
  if (
    !isDate(input.fromDate) ||
    !isDate(input.toDate) ||
    input.fromDate > input.toDate ||
    !validTimeZone(input.timeZone)
  ) {
    return { status: 'unavailable' };
  }
  const url = new URL(
    `/tutors/tutor/${encodeURIComponent(input.tutorId)}/availability`,
    backend.baseUrl,
  );
  const result = await requestJson(
    backend,
    url,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        TimeZone: input.timeZone,
      },
    },
    logger,
    'TutWithUs booking availability lookup',
  );
  const parsed = result.ok
    ? parseAvailableTimes(result.body, input.timeZone)
    : undefined;
  if (!parsed) {
    return { status: 'unavailable' };
  }
  if (!parsed.isAvailableForBooking) {
    return { status: 'not_bookable' };
  }
  const slots = parsed.slots.filter(
    (slot) =>
      slot.date >= input.fromDate &&
      slot.date <= input.toDate &&
      hasMinimumNotice(slot, input.timeZone),
  );
  logger?.info(
    {
      backend: backend.id,
      outcome: 'available',
      returnedSlotCount: parsed.slots.length,
      eligibleSlotCount: slots.length,
      requestedFromDate: input.fromDate,
      requestedToDate: input.toDate,
      firstReturnedDate: parsed.slots[0]?.date,
      lastReturnedDate: parsed.slots.at(-1)?.date,
      timeZone: input.timeZone,
    },
    'TutWithUs booking availability parsed',
  );
  return { status: 'available', slots };
}

export async function createTutWithUsCourse(
  backend: TutWithUsBackendOptions,
  accessToken: string,
  input: CreateCourseInput,
  logger?: Logger,
  now = new Date(),
): Promise<CreateCourseResult> {
  if (
    !input.levelId.trim() ||
    !input.subjectId.trim() ||
    !input.tutorId.trim() ||
    !isDate(input.date) ||
    !isTime(input.timeFrom) ||
    !isTime(input.timeTo) ||
    input.timeTo <= input.timeFrom ||
    !validTimeZone(input.timeZone)
  ) {
    return { status: 'selection_unavailable' };
  }
  const sessionStart = localDateTimeToEpoch(
    input.date,
    input.timeFrom,
    input.timeZone,
  );
  if (
    sessionStart === undefined ||
    sessionStart < now.getTime() + 48 * 60 * 60_000
  ) {
    return { status: 'slot_unavailable' };
  }

  const wallet = await getMyWallet(backend, accessToken, logger);
  if (wallet.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  if (!wallet.wallet.some((credit) => credit.amount > 0)) {
    return { status: 'no_credits' };
  }

  const levels = await getBookingLevels(backend, logger);
  if (levels.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  const level = levels.entries.find((entry) => entry.id === input.levelId);
  if (!level) {
    return { status: 'selection_unavailable' };
  }

  const subjects = await getSubjects(backend, logger);
  if (subjects.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  const subject = subjects.subjects.find(
    (entry) => entry.value === input.subjectId,
  );
  if (!subject) {
    return { status: 'selection_unavailable' };
  }

  const subjectLevels = await getLevelsForSubject(
    backend,
    input.subjectId,
    logger,
  );
  if (subjectLevels.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  if (!subjectLevels.subjects.some((entry) => entry.value === input.levelId)) {
    return { status: 'selection_unavailable' };
  }
  const walletLevelMatch = matchWalletToSubjectLevels(
    wallet.wallet,
    subjectLevels.subjects,
  );
  if (walletLevelMatch.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  if (
    walletLevelMatch.status !== 'eligible' ||
    walletLevelMatch.level.value !== input.levelId
  ) {
    return { status: 'not_eligible' };
  }

  const tutors = await findBookingTutors(
    backend,
    accessToken,
    {
      subjectId: input.subjectId,
      levelId: input.levelId,
      ...(input.curriculum ? { curriculum: input.curriculum } : {}),
      locale: input.locale,
    },
    logger,
  );
  if (tutors.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  const tutor = tutors.tutors.find((entry) => entry.id === input.tutorId);
  if (!tutor) {
    return { status: 'selection_unavailable' };
  }

  const availability = await getTutorBookingAvailability(
    backend,
    accessToken,
    {
      tutorId: input.tutorId,
      fromDate: input.date,
      toDate: input.date,
      timeZone: input.timeZone,
    },
    logger,
  );
  if (availability.status === 'unavailable') {
    return { status: 'unavailable' };
  }
  if (availability.status === 'not_bookable') {
    return { status: 'slot_unavailable' };
  }
  if (
    !availability.slots.some(
      (slot) =>
        slot.date === input.date &&
        slot.timeFrom === input.timeFrom &&
        slot.timeTo === input.timeTo,
    )
  ) {
    return { status: 'slot_unavailable' };
  }

  const description =
    input.description?.trim() || `${subject.label} session with ${tutor.name}`;
  const url = new URL('/courses', backend.baseUrl);
  if (backend.signal?.aborted) return { status: 'unavailable' };
  const result = await requestJson(
    backend,
    url,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...(input.idempotencyKey
          ? { 'Idempotency-Key': input.idempotencyKey }
          : {}),
        TimeZone: input.timeZone,
      },
      body: JSON.stringify({
        description,
        tutorId: input.tutorId,
        subjectId: input.subjectId,
        levelId: input.levelId,
        date: input.date,
        timeFrom: input.timeFrom,
        timeTo: input.timeTo,
      }),
    },
    logger,
    'TutWithUs course booking',
  );
  if (!result.ok) {
    return result.statusCode && result.statusCode < 500
      ? { status: 'unavailable' }
      : { status: 'unknown' };
  }
  if (isRecord(result.body) && result.body.error === true) {
    logger?.warn(
      {
        backend: backend.id,
        path: url.pathname,
        upstreamStatus: result.statusCode,
        outcome: 'unavailable',
        reason: 'backend_error_envelope',
      },
      'TutWithUs course booking rejected in response body',
    );
    return { status: 'unavailable' };
  }
  const data = responseData(result.body);
  if (
    !isRecord(data) ||
    typeof data.courseId !== 'string' ||
    !data.courseId.trim() ||
    typeof data.sessionId !== 'string' ||
    !data.sessionId.trim()
  ) {
    logger?.warn(
      {
        backend: backend.id,
        path: url.pathname,
        upstreamStatus: result.statusCode,
        outcome: 'unknown',
        reason: 'missing_booking_identifiers',
        dataFields: isRecord(data) ? Object.keys(data).sort() : [],
      },
      'TutWithUs course booking response was not confirmable',
    );
    return { status: 'unknown' };
  }
  const confirmationUrl = new URL('/courses/upload', backend.baseUrl);
  const confirmation = await requestJson(
    backend,
    confirmationUrl,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        courseId: data.courseId,
        description,
      }),
    },
    logger,
    'TutWithUs course confirmation',
  );
  if (
    !confirmation.ok ||
    (isRecord(confirmation.body) && confirmation.body.error === true)
  ) {
    logger?.warn(
      {
        backend: backend.id,
        path: confirmationUrl.pathname,
        upstreamStatus: confirmation.ok ? confirmation.statusCode : undefined,
        outcome: 'unknown',
        reason: 'course_confirmation_not_confirmed',
      },
      'TutWithUs course confirmation was not confirmed',
    );
    return { status: 'unknown' };
  }
  logger?.info(
    {
      backend: backend.id,
      path: url.pathname,
      outcome: 'booked',
      courseId: data.courseId,
      sessionId: data.sessionId,
    },
    'TutWithUs course booking confirmed',
  );
  return {
    status: 'booked',
    courseId: data.courseId,
    sessionId: data.sessionId,
    levelName: level.name,
    subjectName: subject.label,
    tutorName: tutor.name,
  };
}
