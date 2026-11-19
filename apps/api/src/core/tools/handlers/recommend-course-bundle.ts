import { z } from 'zod';
import type { CourseBundleResult } from '../../../external/tutwithus/customer.js';
import { defineTool } from '../tool-registry.js';

export function createRecommendCourseBundleTool(
  fetchBundles: (subjectName: string) => Promise<CourseBundleResult>,
) {
  return defineTool({
    name: 'recommend_course_bundle',
    access: { kind: 'public' },
    description:
      'Use only when the caller explicitly asks which bundles cover a course or asks for bundle prices, or after check_subject_eligibility returns no_credits or not_eligible and the caller then requests bundle options. Never call just because a course was named, and never call before checking eligibility in a booking flow or when the caller is eligible. Return all current public bundle families matching the resolved course and selected level without ranking or recommending one. Also call once for an explicit broad programming/coding/technology bundle request: the chain reads subjects/list and returns real related course labels for one clarification question before it fetches levels or bundles. For an exact course it resolves subjects/list, levels/list/{subjectId}, and bundles/active, matching credit levelId to level value, then groups its 5, 10, and 15-session editions. When the result covers multiple teaching levels, the tool asks which returned level the caller needs; call it again with that levelName and the same subjectName. If the caller says any level, all levels, or has no preference, set anyLevel=true instead of inventing a level name; the carousel then includes every matching level. Never ask for another course name when the subject is already resolved. No wallet or account verification is needed. Pass sessions only when the caller requested an edition size. This does not purchase a bundle or prove personal eligibility.',
    parameters: z
      .object({
        subjectName: z.string().trim().min(1).max(128),
        levelName: z.string().trim().min(1).max(128).optional(),
        anyLevel: z.boolean().default(false),
        sessions: z.number().int().positive().optional(),
        another: z.boolean().default(false),
      })
      .strict(),
    maxCallsPerSession: 10,
    redact: () => ({ bundleOptionsRequested: true }),
    async execute(args) {
      const result = await fetchBundles(args.subjectName);
      if (result.status !== 'available')
        return {
          output: result,
          followUpInstructions:
            result.status === 'ambiguous_subject'
              ? 'Briefly say this category includes several courses. Offer at most three returned candidate labels exactly as written, then ask which one the caller wants. Do not fetch or recommend a bundle until they choose one. Do not invent examples.'
              : result.status === 'invalid_subject'
                ? 'Ask one short question for the exact course name. Do not invent a course or bundle.'
                : 'Briefly say current bundle options are unavailable. Do not guess a bundle or price.',
        };
      const levelNames = [
        ...new Map(
          result.families.map((family) => [
            family.levelName.trim().toLocaleLowerCase(),
            family.levelName,
          ]),
        ).values(),
      ];
      if (!args.levelName && !args.anyLevel && levelNames.length > 1) {
        return {
          output: {
            status: 'level_required',
            subjectName: result.subjectName,
            levels: levelNames,
          },
          followUpInstructions:
            'The course is already resolved. Clearly and slowly say each returned level name once, with a short pause between names, then ask which level the caller needs. Mention only the returned level names. Do not ask for another course name, mention prices, or recommend any bundle yet. If the caller says any level, all levels, or no preference, the next call must use anyLevel=true.',
        };
      }
      const requestedLevel = args.anyLevel
        ? undefined
        : args.levelName?.trim().toLocaleLowerCase();
      const matchingFamilies = requestedLevel
        ? result.families.filter(
            (family) =>
              family.levelName.trim().toLocaleLowerCase() === requestedLevel,
          )
        : result.families;
      if (requestedLevel && matchingFamilies.length === 0) {
        return {
          output: {
            status: 'invalid_level',
            subjectName: result.subjectName,
            levels: levelNames,
          },
          followUpInstructions:
            'Say briefly that the requested level was not returned for this course, then ask which of the returned levels the caller needs. Do not ask for another course name or invent a level.',
        };
      }
      if (matchingFamilies.length === 0)
        return {
          output: {
            status: 'no_matching_bundles',
            subjectName: result.subjectName,
          },
          followUpInstructions:
            'Say briefly that no matching active bundle was returned. Do not invent an alternative.',
        };
      const visibleFamilies = args.sessions
        ? matchingFamilies
            .map((family) => ({
              ...family,
              editions: family.editions.filter(
                (edition) => edition.sessions === args.sessions,
              ),
            }))
            .filter((family) => family.editions.length > 0)
        : matchingFamilies;
      if (visibleFamilies.length === 0) {
        return {
          output: {
            status: 'no_matching_bundles',
            subjectName: result.subjectName,
          },
          followUpInstructions:
            'Say briefly that no priced edition was returned for this course. Do not invent a price.',
        };
      }
      return {
        output: {
          status: 'bundle_options',
          subjectName: result.subjectName,
          bundleFamilies: visibleFamilies,
          uiBundleCarousel: {
            subjectName: result.subjectName,
            activeFamilyId: visibleFamilies[0]!.id,
            families: visibleFamilies,
          },
        },
        followUpInstructions:
          "Present the returned bundleFamilies as neutral available options. Never say 'I recommend', 'recommended', 'best', 'selected', or rank one above another. State every returned family name and its returned session editions and total prices, then ask which bundle the caller prefers. In English, every spoken price must use the exact form '<number> Saudi riyals'; the token 'SAR' is forbidden in the response. In French say '<number> riyals saoudiens'. In Arabic say '<number> ريال سعودي'. Use only totalPrice, pricePerSession and sessions returned by the tool. Do not mention UI metadata, level IDs, or claim a purchase.",
      };
    },
  });
}
