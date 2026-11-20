import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../lib/logger.js';
import {
  checkSubjectEligibility,
  getLevelsForSubject,
  getMyBootcamps,
  getMyTutorAvailability,
  getMyWallet,
  getSubjects,
  loginMember,
  queryBackend,
  searchTutorProfiles,
} from './customer.js';

describe('TutWithUs external service client', () => {
  it('filters public tutor profiles and exposes ratings only when published', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        error: false,
        data: [
          {
            _id: 'tutor-1',
            fullName: 'Alice Abou Chacra',
            subjects: ['Chemistry', 'Math'],
            profilePic: 'https://cdn.example.com/alice.jpg',
            degree: 'Masters in Chemical Engineering',
            school: 'American University of Beirut',
            avgRating: 4.9,
            showRating: true,
            curriculums: [{ label: 'British Curriculum', value: 'UK' }],
          },
          {
            _id: 'tutor-2',
            fullName: 'Another Tutor',
            subjects: ['Math'],
            avgRating: 2,
            showRating: false,
            curriculums: [{ label: 'American Curriculum', value: 'US' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = {
      id: 'tutwithus',
      baseUrl: 'https://api.tutwithus.com',
      timeoutMs: 100,
    };

    await expect(
      searchTutorProfiles(backend, {
        subjectName: 'Chemistry',
        curriculum: 'UK',
      }),
    ).resolves.toEqual({
      status: 'available',
      profiles: [
        {
          id: 'tutor-1',
          fullName: 'Alice Abou Chacra',
          subjects: ['Chemistry', 'Math'],
          profilePic: 'https://cdn.example.com/alice.jpg',
          degree: 'Masters in Chemical Engineering',
          school: 'American University of Beirut',
          rating: 4.9,
          curriculums: [{ label: 'British Curriculum', value: 'UK' }],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.tutwithus.com/tutors/profiles'),
      expect.objectContaining({ method: 'GET' }),
    );
    vi.unstubAllGlobals();
  });

  it('matches approximately heard tutor names and related subject concepts', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        error: false,
        data: [
          {
            _id: 'elie',
            fullName: 'Elie Saide',
            subjects: ['Back End and Server Development'],
            curriculums: [{ label: 'Non-Curriculum', value: 'NC' }],
          },
          {
            _id: 'python',
            fullName: 'Python Tutor',
            subjects: ['Python For Professionals'],
            curriculums: [{ label: 'Non-Curriculum', value: 'NC' }],
          },
          {
            _id: 'math',
            fullName: 'Math Tutor',
            subjects: ['Math'],
            curriculums: [{ label: 'American Curriculum', value: 'US' }],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = {
      id: 'tutwithus',
      baseUrl: 'https://api.tutwithus.com',
      timeoutMs: 100,
    };

    await expect(
      searchTutorProfiles(backend, { tutorName: 'Ellie Saeed' }),
    ).resolves.toMatchObject({
      status: 'available',
      profiles: [{ id: 'elie', fullName: 'Elie Saide' }],
    });
    for (const exactTitle of [
      'backend and server development',
      'backend and server development course',
      'Back End and Server Development subject',
    ]) {
      const exactCourse = await searchTutorProfiles(backend, {
        subjectName: exactTitle,
      });
      expect(exactCourse.status).toBe('available');
      if (exactCourse.status === 'available') {
        expect(exactCourse.profiles.map(({ id }) => id)).toEqual(['elie']);
      }
    }
    await expect(
      searchTutorProfiles(backend, {
        subjectName: 'backend and server-side development',
      }),
    ).resolves.toMatchObject({ status: 'available', profiles: [] });
    const coding = await searchTutorProfiles(backend, {
      subjectName: 'coding',
      subjectMatchMode: 'related',
    });
    expect(coding.status).toBe('available');
    if (coding.status === 'available') {
      expect(coding.profiles.map(({ id }) => id)).toEqual(['elie', 'python']);
    }
    const software = await searchTutorProfiles(backend, {
      subjectName: 'software engineering',
      subjectMatchMode: 'related',
    });
    expect(software.status).toBe('available');
    if (software.status === 'available') {
      expect(software.profiles.map(({ id }) => id)).toEqual(['elie', 'python']);
    }
    const compoundTopic = await searchTutorProfiles(backend, {
      subjectName: 'computer science or coding',
      subjectMatchMode: 'related',
    });
    expect(compoundTopic.status).toBe('available');
    if (compoundTopic.status === 'available') {
      expect(compoundTopic.profiles.map(({ id }) => id)).toEqual([
        'elie',
        'python',
      ]);
    }
    for (const heardMath of ['mass', 'message', 'methods']) {
      const math = await searchTutorProfiles(backend, {
        subjectName: heardMath,
        subjectMatchMode: 'related',
      });
      expect(math.status).toBe('available');
      if (math.status === 'available') {
        expect(math.profiles.map(({ id }) => id)).toEqual(['math']);
      }
    }
    vi.unstubAllGlobals();
  });

  it('does not return unrelated tutor subjects for an unknown topic', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          error: false,
          data: [
            {
              _id: 'math',
              fullName: 'Math Tutor',
              subjects: ['Math'],
              curriculums: [{ label: 'British Curriculum', value: 'UK' }],
            },
          ],
        }),
      ),
    );
    await expect(
      searchTutorProfiles(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        { subjectName: 'piano' },
      ),
    ).resolves.toEqual({ status: 'available', profiles: [] });
    vi.unstubAllGlobals();
  });
  it('reads the public subject catalog and keeps only label/value', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        message: 'OK',
        error: false,
        timestamp: 123,
        data: [{ label: 'Math ', value: '67000c1b946a639c101fc906' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const backend = {
      id: 'tutwithus',
      baseUrl: 'https://api.tutwithus.com',
      timeoutMs: 100,
    };

    await expect(getSubjects(backend)).resolves.toEqual({
      status: 'available',
      subjects: [{ label: 'Math', value: '67000c1b946a639c101fc906' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.tutwithus.com/subjects/list'),
      expect.objectContaining({ method: 'GET' }),
    );
    vi.unstubAllGlobals();
  });

  it('gets the levels for the exact subject catalog value', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        message: 'OK',
        error: false,
        timestamp: 123,
        data: [
          {
            label: 'Elementary',
            value: '66faa9e27abf0bd6f0b0305c',
            requiresCurriculum: true,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getLevelsForSubject(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        '67000c1b946a639c101fc906',
      ),
    ).resolves.toEqual({
      status: 'available',
      subjects: [{ label: 'Elementary', value: '66faa9e27abf0bd6f0b0305c' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.tutwithus.com/levels/list/67000c1b946a639c101fc906'),
      expect.objectContaining({ method: 'GET' }),
    );
    vi.unstubAllGlobals();
  });

  it('resolves a named course and returns its safe wallet summary with eligibility', async () => {
    const subjectId = '67000c1b946a639c101fc906';
    const upstreamCalls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        upstreamCalls.push({ url: String(input), init });
        const url = String(input);
        if (url.endsWith('/subjects/list')) {
          return Response.json({
            error: false,
            data: [{ label: 'Math', value: subjectId }],
          });
        }
        if (url.endsWith('/wallet')) {
          return Response.json({
            data: {
              wallet: [
                { creditName: 'Elementary', amount: 0, level: 'Elementary' },
                {
                  creditName: 'Elementary',
                  amount: 4,
                  levelName: 'Elementary',
                },
              ],
            },
          });
        }
        return Response.json({
          error: false,
          data: [{ label: 'Elementary', value: '66faa9e27abf0bd6f0b0305c' }],
        });
      }),
    );

    await expect(
      checkSubjectEligibility(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
        'M a t h',
      ),
    ).resolves.toEqual({
      status: 'eligible',
      subjectId,
      subjectName: 'Math',
      levelId: '66faa9e27abf0bd6f0b0305c',
      levelName: 'Elementary',
      wallet: [
        { bundleName: 'Elementary', credits: 0 },
        { bundleName: 'Elementary', credits: 4 },
      ],
    });
    expect(upstreamCalls.map((call) => call.url)).toEqual([
      'https://api.tutwithus.com/subjects/list',
      'https://api.tutwithus.com/wallet',
      `https://api.tutwithus.com/levels/list/${subjectId}`,
    ]);
    expect(upstreamCalls[0]?.init?.headers).toBeUndefined();
    expect(
      new Headers(upstreamCalls[1]?.init?.headers).get('authorization'),
    ).toBe('Bearer ' + ['private', 'token'].join('-'));
    expect(upstreamCalls[2]?.init?.headers).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('reports an empty wallet without fetching bundle recommendations', async () => {
    const subjectId = '67000c1b946a639c101fc906';
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/subjects/list')) {
          return Response.json({
            error: false,
            data: [{ label: 'Math', value: subjectId }],
          });
        }
        if (url.endsWith('/wallet')) {
          return Response.json({
            data: { wallet: [{ creditName: 'College', amount: 0 }] },
          });
        }
        if (url.endsWith(`/levels/list/${subjectId}`)) {
          return Response.json({
            error: false,
            data: [{ label: 'Languages', value: 'level-id' }],
          });
        }
        return Response.json({
          error: false,
          data: [
            {
              name: 'Language Group Master',
              price: 10110,
              isActive: true,
              credits: [
                {
                  creditName: 'Language Group',
                  amount: 15,
                  levelName: 'Languages',
                  levelId: 'level-id',
                },
              ],
            },
            {
              name: 'Inactive language bundle',
              price: 500,
              isActive: false,
              credits: [
                {
                  creditName: 'Language Group',
                  amount: 5,
                  levelName: 'Languages',
                },
              ],
            },
            {
              name: 'Math bundle',
              price: 400,
              isActive: true,
              credits: [
                { creditName: 'Math', amount: 4, levelName: 'Elementary' },
              ],
            },
            {
              name: 'Empty language bundle',
              price: 250,
              isActive: true,
              credits: [
                {
                  creditName: 'Language Group',
                  amount: 0,
                  levelName: 'Languages',
                },
              ],
            },
          ],
        });
      }),
    );

    await expect(
      checkSubjectEligibility(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
        subjectId,
      ),
    ).resolves.toEqual({
      status: 'no_credits',
      subjectName: 'Math',
      wallet: [{ bundleName: 'College', credits: 0 }],
    });
    expect(calls).toEqual([
      'https://api.tutwithus.com/subjects/list',
      'https://api.tutwithus.com/wallet',
      `https://api.tutwithus.com/levels/list/${subjectId}`,
    ]);
    vi.unstubAllGlobals();
  });

  it('matches a natural course name with a generic course suffix', async () => {
    const subjectId = 'subject-back-end';
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/subjects/list')) {
        return Response.json({
          error: false,
          data: [
            { label: 'Back End and Server Development', value: subjectId },
          ],
        });
      }
      if (url.endsWith('/wallet')) {
        return Response.json({
          data: {
            wallet: [
              {
                creditName: 'Technology',
                amount: 4,
                levelName: 'Elementary',
              },
            ],
          },
        });
      }
      return Response.json({
        error: false,
        data: [{ label: 'Elementary', value: 'level-elementary' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      checkSubjectEligibility(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
        'Backend and server development course',
      ),
    ).resolves.toMatchObject({
      status: 'eligible',
      subjectId,
      subjectName: 'Back End and Server Development',
      levelId: 'level-elementary',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('rejects a subject ID that is not in the live catalog before reading the wallet', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        error: false,
        data: [{ label: 'Math', value: '67000c1b946a639c101fc906' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      checkSubjectEligibility(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
        '66faa9e27abf0bd6f0b0305c',
      ),
    ).resolves.toEqual({
      status: 'invalid_subject',
      subjectName: '66faa9e27abf0bd6f0b0305c',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('asks for clarification when normalized course names match multiple subjects', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        error: false,
        data: [
          { label: 'Back-End', value: 'subject-1' },
          { label: 'Back End', value: 'subject-2' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      checkSubjectEligibility(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
        'backend course',
      ),
    ).resolves.toEqual({
      status: 'ambiguous_subject',
      subjectName: 'backend course',
      candidates: ['Back-End', 'Back End'],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('returns unavailable when a positive wallet entry has no level name', async () => {
    const subjectId = '67000c1b946a639c101fc906';
    const fetchMock = vi.fn(async (input) => {
      if (String(input).endsWith('/subjects/list')) {
        return Response.json({
          error: false,
          data: [{ label: 'Math', value: subjectId }],
        });
      }
      return Response.json({
        data: { wallet: [{ creditName: 'Elementary', amount: 4 }] },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      checkSubjectEligibility(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
        subjectId,
      ),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });

  it('returns not eligible when positive wallet levels do not include the subject', async () => {
    const subjectId = '67000c1b946a639c101fc906';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/subjects/list')) {
          return Response.json({
            error: false,
            data: [{ label: 'Math', value: subjectId }],
          });
        }
        if (url.endsWith('/wallet')) {
          return Response.json({
            data: {
              wallet: [{ creditName: 'College', amount: 4, level: 'College' }],
            },
          });
        }
        return Response.json({
          error: false,
          data: [{ label: 'Elementary', value: '66faa9e27abf0bd6f0b0305c' }],
        });
      }),
    );

    await expect(
      checkSubjectEligibility(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
        subjectId,
      ),
    ).resolves.toEqual({
      status: 'not_eligible',
      subjectId,
      subjectName: 'Math',
      wallet: [{ bundleName: 'College', credits: 4 }],
    });
    vi.unstubAllGlobals();
  });

  it('gets the current caller bootcamps with the login token as a bearer', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { bootcamps: [{ name: 'Python Basics' }] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getMyBootcamps(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
      ),
    ).resolves.toEqual({
      status: 'available',
      data: { data: { bootcamps: [{ name: 'Python Basics' }] } },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.tutwithus.com/bootcamps/me'),
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer private-token' },
      }),
    );
    vi.unstubAllGlobals();
  });

  it('returns unavailable for rejected or malformed bootcamp responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(
          new Response('not json', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    );
    const backend = {
      id: 'tutwithus',
      baseUrl: 'https://api.tutwithus.com',
      timeoutMs: 100,
    };

    await expect(getMyBootcamps(backend, 'private-token')).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(getMyBootcamps(backend, 'private-token')).resolves.toEqual({
      status: 'unavailable',
    });
    vi.unstubAllGlobals();
  });

  it('reads each wallet credit with the login token as a bearer', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          wallet: [
            { creditName: 'Elementary', amount: 4, level: 'Elementary' },
            { creditName: 'Advanced', amount: 0, level: 'Advanced' },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getMyWallet(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
      ),
    ).resolves.toEqual({
      status: 'available',
      wallet: [
        { creditName: 'Elementary', amount: 4, level: 'Elementary' },
        { creditName: 'Advanced', amount: 0, level: 'Advanced' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.tutwithus.com/wallet'),
      expect.objectContaining({
        method: 'GET',
        headers: { authorization: 'Bearer private-token' },
      }),
    );
    vi.unstubAllGlobals();
  });

  it('reads the verified tutor availability with the login token as a bearer', async () => {
    const data = { data: { availability: [{ day: 'Monday', from: '09:00' }] } };
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      Response.json(data),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getMyTutorAvailability(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        'private-token',
      ),
    ).resolves.toEqual({ status: 'available', data });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toEqual(
      new URL('https://api.tutwithus.com/tutors/profiles/availabilty'),
    );
    expect(init?.method).toBe('GET');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      'Bearer ' + ['private', 'token'].join('-'),
    );
    vi.unstubAllGlobals();
  });

  it('rejects wallet responses with missing or invalid credit entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            data: { wallet: [{ creditName: 'A', amount: '2' }] },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            data: { wallet: [{ creditName: 'A', amount: -1 }] },
          }),
        )
        .mockResolvedValueOnce(Response.json({ data: {} })),
    );
    const backend = {
      id: 'tutwithus',
      baseUrl: 'https://api.tutwithus.com',
      timeoutMs: 100,
    };

    await expect(getMyWallet(backend, 'private-token')).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(getMyWallet(backend, 'private-token')).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(getMyWallet(backend, 'private-token')).resolves.toEqual({
      status: 'unavailable',
    });
    vi.unstubAllGlobals();
  });

  it('sends the configured login request and returns the normalized role without logging credentials', async () => {
    const lines: string[] = [];
    const logger = createLogger(
      { level: 'info', service: 'customer-test' },
      new Writable({
        write(chunk, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    );
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { token: 'opaque-token', role: 'Tutor' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      loginMember(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          authLoginPath: '/auth/login',
          timeoutMs: 100,
        },
        { phone: '966500000001', memberId: '000123' },
        logger,
      ),
    ).resolves.toEqual({
      status: 'verified',
      accessToken: 'opaque-token',
      role: 'tutor',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.tutwithus.com/auth/login'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: '966500000001', memberId: '000123' }),
      }),
    );
    const output = lines.join('');
    expect(output).toContain('api.tutwithus.com');
    expect(output).toContain('/auth/login');
    expect(output).toContain('***0001');
    expect(output).toContain('"memberIdLength":6');
    expect(output).not.toContain('966500000001');
    expect(output).not.toContain('000123');
    expect(output).not.toContain('opaque-token');
    vi.unstubAllGlobals();
  });

  it.each([
    { sourceRole: 'Student', normalizedRole: 'student' },
    { sourceRole: 'Parent', normalizedRole: 'parent' },
  ])(
    'normalizes the $sourceRole role for private authorization checks',
    async ({ sourceRole, normalizedRole }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({
            data: { token: 'opaque-token', role: sourceRole },
          }),
        ),
      );
      await expect(
        loginMember(
          {
            id: 'tutwithus',
            baseUrl: 'https://api.tutwithus.com',
            authLoginPath: '/auth/login',
            timeoutMs: 100,
          },
          { phone: '966500000001', memberId: '000123' },
        ),
      ).resolves.toEqual({
        status: 'verified',
        accessToken: 'opaque-token',
        role: normalizedRole,
      });
      vi.unstubAllGlobals();
    },
  );

  it.each([
    { status: 400, outcome: 'not_verified' },
    { status: 401, outcome: 'not_verified' },
    { status: 403, outcome: 'not_verified' },
  ] as const)(
    'maps login HTTP $status to $outcome',
    async ({ status, outcome }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status })),
      );
      await expect(
        loginMember(
          {
            id: 'tutwithus',
            baseUrl: 'https://api.tutwithus.com',
            authLoginPath: '/auth/login',
            timeoutMs: 100,
          },
          { phone: '966500000001', memberId: 'wrong' },
        ),
      ).resolves.toEqual({ status: outcome });
      vi.unstubAllGlobals();
    },
  );

  it('fails closed when the login endpoint is missing or malformed', async () => {
    await expect(
      loginMember(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          timeoutMs: 100,
        },
        { phone: '966500000001', memberId: '000123' },
      ),
    ).resolves.toEqual({ status: 'unavailable' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: { accessToken: 'wrong-key' } })),
    );
    await expect(
      loginMember(
        {
          id: 'tutwithus',
          baseUrl: 'https://api.tutwithus.com',
          authLoginPath: '/auth/login',
          timeoutMs: 100,
        },
        { phone: '966500000001', memberId: '000123' },
      ),
    ).resolves.toEqual({ status: 'unavailable' });
    vi.unstubAllGlobals();
  });

  it('fails closed when the backend endpoint is not configured', async () => {
    await expect(
      queryBackend(
        {
          id: 'current-api',
          baseUrl: 'http://127.0.0.1:3000',
          timeoutMs: 10,
        },
        { phone: '+966500000001' },
      ),
    ).resolves.toEqual({ status: 'unavailable' });
  });

  it('maps a valid registered backend response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ status: 'registered', customerId: 'c1' }),
            { status: 200 },
          ),
      ),
    );
    await expect(
      queryBackend(
        {
          id: 'tutwithus',
          baseUrl: 'https://tutwithus.example',
          lookupPath: '/lookup',
          timeoutMs: 100,
        },
        { phone: '+966500000001' },
      ),
    ).resolves.toEqual({ status: 'registered', customerId: 'c1' });
    vi.unstubAllGlobals();
  });
});
