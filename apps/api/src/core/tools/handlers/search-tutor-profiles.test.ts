import { expect, it, vi } from 'vitest';
import { createSearchTutorProfilesTool } from './search-tutor-profiles.js';

const context = {
  sessionId: 'call-a',
  locale: 'en' as const,
  callsMade: 0,
  retrieval: { topK: 3, minScore: 0.5 },
  responseExpectation: '',
};

const profiles = ['Alice Tutor', 'Bob Tutor', 'Cara Tutor', 'Dan Tutor'].map(
  (fullName, index) => ({
    id: String(index + 1),
    fullName,
    subjects: ['Math'],
    curriculums: [{ label: 'British Curriculum', value: 'UK' }],
    profilePic: `https://cdn.example.com/${index + 1}.jpg`,
    ...(index === 0
      ? { degree: 'MSc', school: 'University', rating: 4.8 }
      : {}),
  }),
);

it('returns all matching safe profiles together with browser image metadata', async () => {
  const search = vi.fn(async () => ({
    status: 'available' as const,
    profiles,
  }));
  const tool = createSearchTutorProfilesTool(search);
  const first = await tool.invoke({ subjectName: 'Math' }, context);
  expect(first).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'available',
        profiles: expect.arrayContaining([
          expect.objectContaining({
            fullName: 'Alice Tutor',
          }),
        ]),
        uiTutorProfiles: expect.arrayContaining([
          expect.objectContaining({
            fullName: 'Alice Tutor',
            profilePic: 'https://cdn.example.com/1.jpg',
          }),
        ]),
      },
    },
  });
  expect(search).toHaveBeenCalledWith({
    subjectName: 'Math',
    subjectMatchMode: 'exact',
  });
  expect(JSON.stringify(first)).toContain('Cara Tutor');
  expect(JSON.stringify(first)).toContain('Dan Tutor');
  expect(first).toMatchObject({
    outcome: {
      followUpInstructions: expect.stringContaining(
        "all returned tutors' fullName values",
      ),
    },
  });

  expect(first).toMatchObject({
    outcome: {
      output: {
        profiles: profiles.map(({ id, fullName }) => ({ id, fullName })),
      },
    },
  });
  expect(tool.access).toEqual({ kind: 'public' });
});

it('allows related matching only when requested', async () => {
  const search = vi.fn(async () => ({
    status: 'available' as const,
    profiles,
  }));
  const tool = createSearchTutorProfilesTool(search);

  await tool.invoke(
    { subjectName: 'coding', subjectMatchMode: 'related' },
    context,
  );

  expect(search).toHaveBeenCalledWith({
    subjectName: 'coding',
    subjectMatchMode: 'related',
  });
});

it('does not invent profiles when the live directory is unavailable', async () => {
  const tool = createSearchTutorProfilesTool(async () => ({
    status: 'unavailable',
  }));
  expect(await tool.invoke({ tutorName: 'Alice' }, context)).toMatchObject({
    kind: 'ok',
    outcome: { output: { status: 'unavailable' } },
  });
});

it('requires a filter unless the caller explicitly requests the full directory', async () => {
  const search = vi.fn(async () => ({
    status: 'available' as const,
    profiles,
  }));
  const tool = createSearchTutorProfilesTool(search);

  expect(await tool.invoke({}, context)).toMatchObject({
    kind: 'invalid',
  });
  expect(search).not.toHaveBeenCalled();
  expect(await tool.invoke({ listAll: true }, context)).toMatchObject({
    kind: 'ok',
    outcome: { output: { status: 'available' } },
  });
  expect(search).toHaveBeenCalledWith({});
});
