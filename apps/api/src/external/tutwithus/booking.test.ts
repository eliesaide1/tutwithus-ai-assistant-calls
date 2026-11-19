import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTutWithUsCourse,
  findBookingTutors,
  getBookingLevels,
  getBookingSubjects,
  getCourses,
  getTutorBookingAvailability,
} from './booking.js';
import type { TutWithUsBackendOptions } from './customer.js';

const backend: TutWithUsBackendOptions = {
  id: 'tutwithus',
  baseUrl: 'https://api.tutwithus.com',
  timeoutMs: 1_000,
};

const walletResponse = {
  data: {
    wallet: [{ creditName: 'Mathematics', levelName: 'Grade 8', amount: 2 }],
  },
};
const levelsResponse = {
  data: [{ _id: 'level-1', name: 'Grade 8', isActive: true }],
};
const subjectsResponse = {
  data: [{ _id: 'subject-1', name: 'Mathematics', isActive: true }],
};
const publicSubjectsResponse = {
  error: false,
  data: [{ value: 'subject-1', label: 'Mathematics' }],
};
const subjectLevelsResponse = {
  error: false,
  data: [{ value: 'level-1', label: 'Grade 8' }],
};
const tutorsResponse = {
  data: [
    {
      _id: 'tutor-1',
      firstName: 'Taylor',
      lastName: 'Tutor',
      profilePic: 'https://cdn.example.com/taylor.jpg',
      firstNameAr: 'ØªØ§ÙŠÙ„ÙˆØ±',
      lastNameAr: 'Ù…Ø¹Ù„Ù…',
      isAvailableForBooking: true,
    },
  ],
};

describe('course history', () => {
  it('returns the tutor name from the session description when tutorId is not populated', async () => {
    vi.setSystemTime(new Date('2026-11-18T00:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            {
              _id: 'course-1',
              isCanceled: false,
              description:
                'Back End and Server Development session with Elie Saide',
              tutorId: 'tutor-1',
              timeFrom: '2026-11-22T10:00:00.000Z',
              timeTo: '2026-11-22T11:00:00.000Z',
            },
          ],
        }),
      ),
    );

    await expect(
      getCourses(
        backend,
        'verified-token',
        { scope: 'upcoming' },
        new Date('2026-11-18T00:00:00.000Z'),
      ),
    ).resolves.toEqual({
      status: 'available',
      courses: [
        {
          id: 'course-1',
          subjectName: 'Back End and Server Development',
          tutorName: 'Elie Saide',
          timeFrom: '2026-11-22T10:00:00.000Z',
          timeTo: '2026-11-22T11:00:00.000Z',
        },
      ],
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TutWithUs booking service', () => {
  it('maps subject catalog value and label into booking id and name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          error: false,
          data: [
            {
              label: 'AI-Augmented Engineering ',
              value: '6a0dfa75b',
            },
          ],
        }),
      ),
    );

    await expect(
      getBookingSubjects(backend, 'verified-token', 'level-1'),
    ).resolves.toEqual({
      status: 'available',
      entries: [{ id: '6a0dfa75b', name: 'AI-Augmented Engineering' }],
    });
  });

  it('returns only active booking levels and subjects and forwards exact lookup ids', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/levels/active') {
          return Response.json({
            data: [
              ...levelsResponse.data,
              { _id: 'inactive', name: 'Inactive', isActive: false },
            ],
          });
        }
        if (url.pathname === '/subjects') {
          return Response.json(subjectsResponse);
        }
        if (url.pathname === '/tutors/profiles/booking') {
          return Response.json({
            data: [
              ...tutorsResponse.data,
              {
                _id: 'unavailable-tutor',
                firstName: 'Unavailable',
                lastName: 'Tutor',
                isAvailableForBooking: false,
              },
            ],
          });
        }
        return Response.json({ data: [] });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getBookingLevels(backend)).resolves.toEqual({
      status: 'available',
      entries: [{ id: 'level-1', name: 'Grade 8' }],
    });
    await expect(
      getBookingSubjects(backend, 'verified-token', 'level-1'),
    ).resolves.toEqual({
      status: 'available',
      entries: [{ id: 'subject-1', name: 'Mathematics' }],
    });
    await expect(
      findBookingTutors(backend, 'verified-token', {
        subjectId: 'subject-1',
        levelId: 'level-1',
        curriculum: 'US',
        locale: 'ar-SA',
      }),
    ).resolves.toEqual({
      status: 'available',
      tutors: [
        {
          id: 'tutor-1',
          name: 'ØªØ§ÙŠÙ„ÙˆØ± Ù…Ø¹Ù„Ù…',
          profilePic: 'https://cdn.example.com/taylor.jpg',
        },
      ],
    });

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls[0]?.pathname).toBe('/levels/active');
    expect(urls[1]?.searchParams.get('levelId')).toBe('level-1');
    expect(urls[2]?.searchParams).toEqual(
      new URLSearchParams({
        subjectId: 'subject-1',
        levelId: 'level-1',
        curriculum: 'US',
      }),
    );
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer verified-token');
    expect(
      new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer verified-token');
  });

  it('passes the caller timezone and filters inactive and under-48-hour slots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
          data: {
            isAvailableForBooking: true,
            availableTimes: [
              {
                date: '2026-11-15',
                status: 'ACTIVE',
                isAvailable: true,
                timeSlots: [
                  {
                    startHour: '18:30',
                    endHour: '19:00',
                    isAvailable: true,
                  },
                  {
                    startHour: '19:00',
                    endHour: '19:30',
                    isAvailable: true,
                  },
                  {
                    startHour: '20:00',
                    endHour: '20:30',
                    isAvailable: false,
                  },
                ],
              },
              {
                date: '2026-11-16',
                status: 'INACTIVE',
                isAvailable: true,
                timeSlots: [
                  {
                    startHour: '10:00',
                    endHour: '10:30',
                    isAvailable: true,
                  },
                ],
              },
            ],
          },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getTutorBookingAvailability(backend, 'verified-token', {
        tutorId: 'tutor-1',
        fromDate: '2026-11-15',
        toDate: '2026-11-16',
        timeZone: 'Asia/Riyadh',
      }),
    ).resolves.toEqual({
      status: 'available',
      slots: [{ date: '2026-11-15', timeFrom: '19:00', timeTo: '19:30' }],
    });
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toBe(
      'https://api.tutwithus.com/tutors/tutor/tutor-1/availability',
    );
    expect(new Headers(requestInit?.headers).get('TimeZone')).toBe(
      'Asia/Riyadh',
    );
    expect(new Headers(requestInit?.headers).get('authorization')).toBe(
      'Bearer verified-token',
    );
  });

  it('parses the live Sunday availability response for Lebanon', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T11:21:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          message: 'OK',
          error: false,
          timestamp: 1794828176442,
          data: {
            isAvailableForBooking: true,
            availableTimes: [
              ['2026-11-22', '09:30', '10:00'],
              ['2026-11-22', '10:00', '11:00'],
              ['2026-11-29', '09:30', '10:00'],
              ['2026-11-29', '10:00', '11:00'],
              ['2026-12-06', '09:30', '10:00'],
              ['2026-12-06', '10:00', '11:00'],
              ['2026-12-13', '09:30', '10:00'],
              ['2026-12-13', '10:00', '11:00'],
            ].map(([date, startHour, endHour], index) => ({
              date,
              timeSlots: [{ startHour, endHour, isAvailable: true }],
              status: 'ACTIVE',
              createdAt: '2026-11-13T09:15:04.921Z',
              _id: `availability-${index}`,
              isAvailable: true,
            })),
          },
        }),
      ),
    );

    await expect(
      getTutorBookingAvailability(backend, 'verified-token', {
        tutorId: 'tutor-1',
        fromDate: '2026-11-18',
        toDate: '2026-12-13',
        timeZone: 'Asia/Beirut',
      }),
    ).resolves.toEqual({
      status: 'available',
      slots: [
        { date: '2026-11-22', timeFrom: '09:30', timeTo: '10:00' },
        { date: '2026-11-22', timeFrom: '10:00', timeTo: '11:00' },
        { date: '2026-11-29', timeFrom: '09:30', timeTo: '10:00' },
        { date: '2026-11-29', timeFrom: '10:00', timeTo: '11:00' },
        { date: '2026-12-06', timeFrom: '09:30', timeTo: '10:00' },
        { date: '2026-12-06', timeFrom: '10:00', timeTo: '11:00' },
        { date: '2026-12-13', timeFrom: '09:30', timeTo: '10:00' },
        { date: '2026-12-13', timeFrom: '10:00', timeTo: '11:00' },
      ],
    });
  });

  it('converts UTC availability timestamps into the caller timezone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            isAvailableForBooking: true,
            availableTimes: [
              {
                date: '2026-11-16',
                status: 'ACTIVE',
                isAvailable: true,
                timeSlots: [
                  {
                    startHour: '2026-11-15T15:00:00.000Z',
                    endHour: '2026-11-15T15:30:00.000Z',
                    isAvailable: true,
                  },
                  {
                    startHour: '2026-11-15T16:00:00.000Z',
                    endHour: '2026-11-15T16:30:00.000Z',
                    isAvailable: true,
                  },
                  {
                    startHour: '2026-11-16T01:00:00.000Z',
                    endHour: '2026-11-16T02:00:00.000Z',
                    isAvailable: true,
                  },
                ],
              },
            ],
          },
        }),
      ),
    );

    await expect(
      getTutorBookingAvailability(backend, 'verified-token', {
        tutorId: 'tutor-1',
        fromDate: '2026-11-15',
        toDate: '2026-11-16',
        timeZone: 'America/Los_Angeles',
      }),
    ).resolves.toEqual({
      status: 'available',
      slots: [
        { date: '2026-11-15', timeFrom: '08:00', timeTo: '08:30' },
        { date: '2026-11-15', timeFrom: '17:00', timeTo: '18:00' },
      ],
    });
  });

  it('does not expose child slots when the top-level booking flag is false', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            isAvailableForBooking: false,
            availableTimes: [
              {
                date: '2026-11-22',
                status: 'ACTIVE',
                isAvailable: true,
                timeSlots: [
                  {
                    startHour: '09:30',
                    endHour: '10:00',
                    isAvailable: true,
                  },
                ],
              },
            ],
          },
        }),
      ),
    );

    await expect(
      getTutorBookingAvailability(backend, 'verified-token', {
        tutorId: 'tutor-1',
        fromDate: '2026-11-22',
        toDate: '2026-11-22',
        timeZone: 'Asia/Riyadh',
      }),
    ).resolves.toEqual({ status: 'not_bookable' });
  });

  it('fails closed when the upstream booking flag is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: {
            availableTimes: [
              {
                date: '2026-11-22',
                status: 'ACTIVE',
                isAvailable: true,
                timeSlots: [
                  {
                    startHour: '09:30',
                    endHour: '10:00',
                    isAvailable: true,
                  },
                ],
              },
            ],
          },
        }),
      ),
    );

    await expect(
      getTutorBookingAvailability(backend, 'verified-token', {
        tutorId: 'tutor-1',
        fromDate: '2026-11-22',
        toDate: '2026-11-22',
        timeZone: 'Asia/Riyadh',
      }),
    ).resolves.toEqual({ status: 'unavailable' });
  });

  it('rechecks wallet, selections, and slot before posting an authenticated course booking', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        requests.push({ url, init });
        if (url.pathname === '/wallet') {
          return Response.json(walletResponse);
        }
        if (url.pathname === '/levels/active') {
          return Response.json(levelsResponse);
        }
        if (url.pathname === '/subjects/list') {
          return Response.json(publicSubjectsResponse);
        }
        if (url.pathname === '/levels/list/subject-1') {
          return Response.json(subjectLevelsResponse);
        }
        if (url.pathname === '/tutors/profiles/booking') {
          return Response.json(tutorsResponse);
        }
        if (url.pathname === '/tutors/tutor/tutor-1/availability') {
          return Response.json({
            data: {
              isAvailableForBooking: true,
              availableTimes: [
                {
                  date: '2026-11-16',
                  status: 'ACTIVE',
                  isAvailable: true,
                  timeSlots: [
                    {
                      startHour: '10:00',
                      endHour: '10:30',
                      isAvailable: true,
                    },
                  ],
                },
              ],
            },
          });
        }
        if (url.pathname === '/courses') {
          return Response.json({
            data: { courseId: 'course-1', sessionId: 'session-1' },
          });
        }
        if (url.pathname === '/courses/upload') {
          return Response.json({ error: false });
        }
        return Response.json({}, { status: 404 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createTutWithUsCourse(backend, 'verified-token', {
        levelId: 'level-1',
        subjectId: 'subject-1',
        tutorId: 'tutor-1',
        date: '2026-11-16',
        timeFrom: '10:00',
        timeTo: '10:30',
        timeZone: 'Asia/Riyadh',
        description: 'Back end session with Taylor Tutor',
        locale: 'en',
      }),
    ).resolves.toMatchObject({
      status: 'booked',
      courseId: 'course-1',
      sessionId: 'session-1',
      levelName: 'Grade 8',
      subjectName: 'Mathematics',
      tutorName: 'Taylor Tutor',
    });

    expect(requests.map(({ url }) => url.pathname)).toEqual([
      '/wallet',
      '/levels/active',
      '/subjects/list',
      '/levels/list/subject-1',
      '/tutors/profiles/booking',
      '/tutors/tutor/tutor-1/availability',
      '/courses',
      '/courses/upload',
    ]);
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe(
      'Bearer verified-token',
    );
    expect(new Headers(requests[5]?.init?.headers).get('TimeZone')).toBe(
      'Asia/Riyadh',
    );
    for (const request of [requests[4]!, requests[5]!]) {
      expect(new Headers(request.init?.headers).get('authorization')).toBe(
        'Bearer verified-token',
      );
    }
    expect(new Headers(requests[6]?.init?.headers).get('authorization')).toBe(
      'Bearer verified-token',
    );
    expect(JSON.parse(String(requests[6]?.init?.body))).toEqual({
      description: 'Back end session with Taylor Tutor',
      tutorId: 'tutor-1',
      subjectId: 'subject-1',
      levelId: 'level-1',
      date: '2026-11-16',
      timeFrom: '10:00',
      timeTo: '10:30',
    });
    expect(new Headers(requests[7]?.init?.headers).get('authorization')).toBe(
      'Bearer verified-token',
    );
    expect(new Headers(requests[7]?.init?.headers).get('content-type')).toBe(
      'application/json',
    );
    expect(JSON.parse(String(requests[7]?.init?.body))).toEqual({
      courseId: 'course-1',
      description: 'Back end session with Taylor Tutor',
    });
  });

  it('does not report a reservation as booked when course confirmation fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const { pathname } = new URL(String(input));
      if (pathname === '/wallet') return Response.json(walletResponse);
      if (pathname === '/levels/active') return Response.json(levelsResponse);
      if (pathname === '/subjects/list') {
        return Response.json(publicSubjectsResponse);
      }
      if (pathname === '/levels/list/subject-1') {
        return Response.json(subjectLevelsResponse);
      }
      if (pathname === '/tutors/profiles/booking') {
        return Response.json(tutorsResponse);
      }
      if (pathname === '/tutors/tutor/tutor-1/availability') {
        return Response.json({
          data: {
            isAvailableForBooking: true,
            availableTimes: [
              {
                date: '2026-11-16',
                status: 'ACTIVE',
                isAvailable: true,
                timeSlots: [
                  {
                    startHour: '10:00',
                    endHour: '10:30',
                    isAvailable: true,
                  },
                ],
              },
            ],
          },
        });
      }
      if (pathname === '/courses') {
        return Response.json({
          data: { courseId: 'course-1', sessionId: 'session-1' },
        });
      }
      if (pathname === '/courses/upload') {
        return Response.json({ error: true }, { status: 400 });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createTutWithUsCourse(backend, 'verified-token', {
        levelId: 'level-1',
        subjectId: 'subject-1',
        tutorId: 'tutor-1',
        date: '2026-11-16',
        timeFrom: '10:00',
        timeTo: '10:30',
        timeZone: 'Asia/Riyadh',
        locale: 'en',
      }),
    ).resolves.toEqual({ status: 'unknown' });
    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toContain('/courses/upload');
  });

  it('does not post when wallet credits do not cover the chosen subject level', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/wallet') {
        return Response.json({
          data: {
            wallet: [
              { creditName: 'Science', levelName: 'Grade 7', amount: 2 },
            ],
          },
        });
      }
      if (url.pathname === '/levels/active') {
        return Response.json(levelsResponse);
      }
      if (url.pathname === '/subjects/list') {
        return Response.json(publicSubjectsResponse);
      }
      if (url.pathname === '/levels/list/subject-1') {
        return Response.json(subjectLevelsResponse);
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createTutWithUsCourse(backend, 'verified-token', {
        levelId: 'level-1',
        subjectId: 'subject-1',
        tutorId: 'tutor-1',
        date: '2026-11-16',
        timeFrom: '10:00',
        timeTo: '10:30',
        timeZone: 'Asia/Riyadh',
        locale: 'en',
      }),
    ).resolves.toEqual({ status: 'not_eligible' });
    expect(
      fetchMock.mock.calls.some(
        ([input]) => new URL(String(input)).pathname === '/courses',
      ),
    ).toBe(false);
  });

  it('stops before looking up selections when the verified wallet has no positive credits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T16:00:00.000Z'));
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { wallet: [{ creditName: 'Math', amount: 0 }] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createTutWithUsCourse(backend, 'verified-token', {
        levelId: 'level-1',
        subjectId: 'subject-1',
        tutorId: 'tutor-1',
        date: '2026-11-16',
        timeFrom: '10:00',
        timeTo: '10:30',
        timeZone: 'Asia/Riyadh',
        locale: 'en',
      }),
    ).resolves.toEqual({ status: 'no_credits' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
