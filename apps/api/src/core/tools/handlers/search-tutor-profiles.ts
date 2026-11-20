import { z } from 'zod';
import type {
  TutorProfileSearch,
  TutorProfilesResult,
} from '../../../external/tutwithus/customer.js';
import { defineTool } from '../tool-registry.js';

const SearchTutorProfilesArgumentsSchema = z
  .object({
    tutorName: z.string().trim().min(1).max(128).optional(),
    subjectName: z.string().trim().min(1).max(128).optional(),
    subjectMatchMode: z.enum(['exact', 'related']).default('exact'),
    curriculum: z.string().trim().min(1).max(128).optional(),
    listAll: z.boolean().default(false),
    another: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    const hasFilter = Boolean(
      value.tutorName || value.subjectName || value.curriculum,
    );
    if (!value.listAll && !hasFilter) {
      context.addIssue({
        code: 'custom',
        message:
          'Provide tutorName, subjectName, or curriculum. Use listAll=true only when the caller explicitly asks for the full tutor directory.',
      });
    }
    if (value.listAll && hasFilter) {
      context.addIssue({
        code: 'custom',
        message: 'Do not combine listAll with a tutor filter.',
      });
    }
  });

export function createSearchTutorProfilesTool(
  search: (query: TutorProfileSearch) => Promise<TutorProfilesResult>,
) {
  return defineTool({
    name: 'search_tutor_profiles',
    access: { kind: 'public' },
    description:
      "Use this public live directory for questions about TutWithUs tutor names, subjects, degrees, schools, supported curriculums, or published ratings. For a named subject or course, pass the caller's complete subjectName exactly as heard and set subjectMatchMode='exact'; exact matching never expands to related subjects. Use subjectMatchMode='related' only for a broad category request such as 'coding' or 'computer science or coding'. Never broaden a named subject to a related category or paraphrase its title. Tutor names are typo tolerant, so pass tutorName exactly as heard. Use listAll=true only when the caller explicitly asks for the full tutor directory and gives no filter. Do not use search_knowledge for current tutor-profile questions. Every call returns all matching profiles together, so do not call again with another=true after listing them; briefly say all matches were already listed if the caller asks for more. A public profile does not prove that a tutor can be booked or has an open time slot. When the caller asks for the calendar or availability of a returned tutor without naming a course, use check_tutor_calendar with that profile's id if it is listed and the caller is verified; a course name is not required to view the calendar. Never infer gender, languages, experience, age, nationality, ranking, or suitability from a name or picture. Never call a tutor the best unless returned data supports a requested objective comparison. A missing rating means no rating is published, not zero.",
    parameters: SearchTutorProfilesArgumentsSchema,
    maxCallsPerSession: 10,
    redact: (args) => ({
      tutorNameProvided: Boolean(args.tutorName),
      subjectNameProvided: Boolean(args.subjectName),
      curriculumProvided: Boolean(args.curriculum),
      listAll: args.listAll,
      another: args.another,
    }),
    async execute(args) {
      const query = {
        ...(args.tutorName ? { tutorName: args.tutorName } : {}),
        ...(args.subjectName
          ? {
              subjectName: args.subjectName,
              subjectMatchMode: args.subjectMatchMode,
            }
          : {}),
        ...(args.curriculum ? { curriculum: args.curriculum } : {}),
      };
      const result = await search(query);
      if (result.status === 'unavailable') {
        return {
          output: { status: 'unavailable' },
          followUpInstructions:
            'Briefly say current tutor profiles are unavailable. Do not substitute uploaded knowledge, guess a tutor, or claim availability.',
        };
      }
      const profiles = result.profiles;
      if (profiles.length === 0) {
        return {
          output: { status: 'no_matches' },
          followUpInstructions:
            'Say briefly that no matching tutor profile was found. Do not invent a tutor.',
        };
      }
      const namesOnly = Boolean(
        args.subjectName && !args.tutorName && !args.curriculum,
      );
      return {
        output: {
          status: 'available',
          ...(args.subjectName ? { requestedSubject: args.subjectName } : {}),
          profiles: profiles.map(
            ({
              id,
              fullName,
              subjects,
              curriculums,
              degree,
              school,
              rating,
            }) =>
              namesOnly
                ? { id, fullName }
                : {
                    id,
                    fullName,
                    subjects,
                    curriculums,
                    ...(degree ? { degree } : {}),
                    ...(school ? { school } : {}),
                    ...(rating !== undefined
                      ? { rating, ratingPublished: true }
                      : { ratingPublished: false }),
                  },
          ),
          uiTutorProfiles: profiles.flatMap(({ fullName, profilePic }) =>
            profilePic ? [{ fullName, profilePic }] : [],
          ),
        },
        followUpInstructions: namesOnly
          ? "Reply with all returned tutors' fullName values, exactly as written, in one concise sentence. Do not omit or paginate names. Preserve requestedSubject internally and never rename, correct, or paraphrase it in a later confirmation. Do not mention subjects, degrees, schools, curriculums, ratings, matching logic, availability, profile pictures, or offer additional help."
          : "Answer only from the returned profile fields and in the caller's language. Say each tutor's fullName exactly as returned so the browser can show the matching picture. Be concise and mention only details relevant to the question. Never read, describe, or mention profilePic or uiTutorProfiles. Do not infer missing facts. If ratingPublished is false, say no rating is published only when the caller asked about rating. Do not claim booking eligibility or an open slot. For a calendar request, pass the returned profile id to check_tutor_calendar when that tool is listed; do not require a course name. Never route tutor availability to bundle recommendation.",
      };
    },
  });
}
