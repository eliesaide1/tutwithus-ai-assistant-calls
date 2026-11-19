import { expect, it, vi } from 'vitest';
import { createRecommendCourseBundleTool } from './recommend-course-bundle.js';
const context = {
  sessionId: 'call-a',
  locale: 'en' as const,
  callsMade: 0,
  retrieval: { topK: 3, minScore: 0.5 },
  responseExpectation: '',
};
function setup() {
  const fetchBundles = vi.fn(async () => ({
    status: 'available' as const,
    subjectId: 's',
    subjectName: 'Python',
    families: ['First', 'Second'].map((name) => ({
      id: name,
      name,
      deliveryMode: 'one_to_one' as const,
      levelId: 'l',
      levelName: 'Technology',
      editions: [
        {
          id: `${name}-5`,
          name: `${name} Start`,
          sessions: 5,
          totalPrice: 100,
          pricePerSession: 20,
          currency: 'SAR' as const,
        },
        {
          id: `${name}-10`,
          name: `${name} Boost`,
          sessions: 10,
          totalPrice: 180,
          pricePerSession: 18,
          currency: 'SAR' as const,
        },
      ],
    })),
  }));
  return { tool: createRecommendCourseBundleTool(fetchBundles), fetchBundles };
}
it('returns every matching bundle as neutral options', async () => {
  const { tool } = setup();
  const args = { subjectName: 'Python' };
  const first = await tool.invoke(args, context);
  expect(first).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'bundle_options',
        bundleFamilies: [{ name: 'First' }, { name: 'Second' }],
        uiBundleCarousel: { activeFamilyId: 'First' },
      },
    },
  });
  expect(await tool.invoke(args, context)).toEqual(first);
  expect(await tool.invoke(args, { ...context, sessionId: 'call-b' })).toEqual(
    first,
  );
  expect(tool.access).toEqual({ kind: 'public' });
});
it('selects the requested session edition without treating it as another family', async () => {
  const { tool } = setup();
  expect(
    await tool.invoke({ subjectName: 'Python', sessions: 10 }, context),
  ).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'bundle_options',
        bundleFamilies: [
          {
            name: 'First',
            editions: [
              {
                sessions: 10,
                totalPrice: 180,
                pricePerSession: 18,
                currency: 'SAR',
              },
            ],
          },
          {
            name: 'Second',
            editions: [
              {
                sessions: 10,
                totalPrice: 180,
                pricePerSession: 18,
                currency: 'SAR',
              },
            ],
          },
        ],
      },
    },
  });
});
it('fails without inventing a suggestion when upstream data is unavailable', async () => {
  const tool = createRecommendCourseBundleTool(async () => ({
    status: 'unavailable',
  }));
  expect(await tool.invoke({ subjectName: 'Python' }, context)).toMatchObject({
    kind: 'ok',
    outcome: { output: { status: 'unavailable' } },
  });
});
it('asks the caller to choose from live course candidates for a broad category', async () => {
  const tool = createRecommendCourseBundleTool(async () => ({
    status: 'ambiguous_subject',
    candidates: ['Python', 'Web Development', 'Software Engineering'],
  }));
  const result = await tool.invoke(
    { subjectName: 'programming courses' },
    context,
  );
  expect(result).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'ambiguous_subject',
        candidates: ['Python', 'Web Development', 'Software Engineering'],
      },
    },
  });
  if (result.kind !== 'ok') throw new Error('missing tool result');
  expect(result.outcome.followUpInstructions).toContain(
    'Offer at most three returned candidate labels exactly as written',
  );
  expect(result.outcome.followUpInstructions).toContain(
    'Do not invent examples',
  );
});

it('asks for the teaching level instead of choosing an arbitrary bundle family', async () => {
  const tool = createRecommendCourseBundleTool(async () => ({
    status: 'available',
    subjectId: 'math',
    subjectName: 'Math',
    families: [
      {
        id: 'middle',
        name: 'Middle Group',
        deliveryMode: 'group',
        levelId: 'middle-level',
        levelName: 'Middle',
        editions: [
          {
            id: 'middle-5',
            name: 'Middle Group Start',
            sessions: 5,
            totalPrice: 3145,
            pricePerSession: 629,
            currency: 'SAR',
          },
        ],
      },
      {
        id: 'secondary',
        name: 'Senior Start',
        deliveryMode: 'one_to_one',
        levelId: 'secondary-level',
        levelName: 'Secondary',
        editions: [
          {
            id: 'secondary-5',
            name: 'Senior Start',
            sessions: 5,
            totalPrice: 1075,
            pricePerSession: 215,
            currency: 'SAR',
          },
        ],
      },
    ],
  }));

  expect(await tool.invoke({ subjectName: 'Math' }, context)).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'level_required',
        subjectName: 'Math',
        levels: ['Middle', 'Secondary'],
      },
    },
  });
  expect(
    await tool.invoke({ subjectName: 'Math', levelName: 'Secondary' }, context),
  ).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'bundle_options',
        bundleFamilies: [{ name: 'Senior Start', levelName: 'Secondary' }],
        uiBundleCarousel: { families: [{ levelName: 'Secondary' }] },
      },
    },
  });
  expect(
    await tool.invoke(
      { subjectName: 'Math', anyLevel: true },
      {
        ...context,
        sessionId: 'any-level-call',
      },
    ),
  ).toMatchObject({
    kind: 'ok',
    outcome: {
      output: {
        status: 'bundle_options',
        uiBundleCarousel: {
          families: [{ levelName: 'Middle' }, { levelName: 'Secondary' }],
        },
      },
    },
  });
});
