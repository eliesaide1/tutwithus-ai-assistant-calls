import { z } from 'zod';

export const LOCALES = ['ar-SA', 'en', 'fr'] as const;

// What each case is meant to prove. The pass thresholds in thresholds.ts are
// set per category.
export const CATEGORIES = [
  // A fact that is in the approved knowledge: found, cited and repeated.
  'in_scope',
  // A fact that is NOT in the knowledge: say so, invent nothing.
  'unknown',
  // Not about TutWithUs at all.
  'out_of_scope',
  // Pressure to state a price, discount or guarantee the knowledge lacks.
  'price_bait',
  // Instructions hidden in the caller's words or in a knowledge passage.
  'injection',
  // An account action asked for by a caller who is not a verified customer.
  'unregistered_account',
  // A booking request.
  'booking',
  // A verified customer using an account action.
  'registered_action',
  // Safety or wellbeing wording.
  'safety',
] as const;

const ToolNameSchema = z.enum([
  'search_knowledge',
  'escalate_to_human',
  'end_call',
  'request_member_id',
  'verify_member_id',
  'get_my_bootcamps',
  'get_my_wallet',
  'get_subjects',
  'get_booking_levels',
  'get_booking_subjects',
  'find_booking_tutors',
  'check_tutor_availability',
  'book_course',
]);

// A pattern tested case-insensitively against everything the agent said.
const PatternSchema = z
  .string()
  .min(1)
  .refine(
    (pattern) => {
      try {
        new RegExp(pattern, 'iu');
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Not a valid regular expression.' },
  );

const PassageSchema = z
  .object({
    sourceId: z.string().min(1),
    title: z.string().min(1),
    content: z.string().min(1),
  })
  .strict();

export const EvalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z-]+-[a-z0-9_-]+$/),
    locale: z.enum(LOCALES),
    category: z.enum(CATEGORIES),
    description: z.string().min(1),
    // Registered means the server matched the caller to a customer. Anything
    // else is treated as not verified.
    caller: z.enum(['registered', 'unregistered']),
    // What search_knowledge returns for ANY query in this case. Empty means
    // "nothing found".
    knowledge: z.array(PassageSchema).default([]),
    subjects: z
      .array(
        z
          .object({
            label: z.string().min(1),
            value: z.string().regex(/^[a-f\d]{24}$/i),
          })
          .strict(),
      )
      .default([]),
    // Fixture used by the direct-booking tutor and availability tools.
    tutors: z
      .array(
        z
          .object({
            displayName: z.string().min(1),
            courses: z.array(z.string().min(1)),
            slots: z.array(z.object({ start: z.string(), end: z.string() })),
          })
          .strict(),
      )
      .optional(),
    bookingAvailabilityUnavailable: z.boolean().default(false),
    // What the caller says, one entry per turn.
    turns: z.array(z.string().min(1)).min(1),
    expect: z
      .object({
        // Tools the agent must try at least once.
        toolsCalled: z.array(ToolNameSchema).default([]),
        // Tools the agent must never try.
        toolsNotCalled: z.array(ToolNameSchema).default([]),
        // Tools that must never actually run. A refused attempt is fine, so this
        // holds even for a model that tries, because the server decides.
        toolsNotExecuted: z.array(ToolNameSchema).default([]),
        // Sources that must be cited by a search the agent made.
        citesSources: z.array(z.string()).default([]),
        // Every pattern must match somewhere in what the agent said.
        mustMatch: z.array(PatternSchema).default([]),
        // No pattern may match anywhere in what the agent said.
        mustNotMatch: z.array(PatternSchema).default([]),
      })
      .strict(),
  })
  .strict();

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalCategory = (typeof CATEGORIES)[number];
export type EvalLocale = (typeof LOCALES)[number];
