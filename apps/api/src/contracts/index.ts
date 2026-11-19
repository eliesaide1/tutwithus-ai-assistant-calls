import { z } from 'zod';

export const LocaleSchema = z.enum(['ar-SA', 'en', 'fr']);

export const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, 'A valid IANA time zone is required.');

export const ConsentVersionSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}\.\d+$/);

export const PublicConfigResponseSchema = z
  .object({
    languages: z
      .array(LocaleSchema)
      .min(1)
      .refine(
        (languages) => new Set(languages).size === languages.length,
        'Languages must not contain duplicates.',
      ),
    consentVersion: ConsentVersionSchema,
    consentText: z.record(LocaleSchema, z.string().trim().min(1)),
    maxCallSec: z.number().int().positive(),
  })
  .strict();

export const CreateVoiceSessionRequestSchema = z
  .object({
    locale: LocaleSchema,
    timeZone: TimeZoneSchema.optional(),
    consentVersion: ConsentVersionSchema,
    consentAccepted: z.literal(true),
    phone: z.string().trim().min(8).max(24).optional(),
    captchaToken: z.string().max(2048).optional(),
    identityProof: z.string().max(4096).optional(),
  })
  .strict();

export const VoiceTranscriptEntrySchema = z
  .object({
    eventId: z.string().trim().min(1).max(256),
    speaker: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const SaveVoiceTranscriptRequestSchema = VoiceTranscriptEntrySchema;

export const SaveVoiceTranscriptResponseSchema = z
  .object({ status: z.literal('stored') })
  .strict();

export const CreateVoiceSessionResponseSchema = z
  .object({
    sessionId: z.string().min(1),
    sessionToken: z.string().min(1),
    maxDurationSec: z.number().int().positive(),
  })
  .strict();

export const VoiceSessionIdSchema = z.uuid();

export const RealtimeConnectionRequestSchema = z
  .object({
    sdp: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1024),
  })
  .strict();

export const RealtimeConnectionResponseSchema = z
  .object({
    sdp: z
      .string()
      .min(1)
      .max(64 * 1024),
    greeting: z.string().trim().min(1).max(500),
  })
  .strict();

export const EndVoiceSessionRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const EndVoiceSessionResponseSchema = z
  .object({
    status: z.literal('ended'),
  })
  .strict();

export const ConfirmBookingRequestSchema = z.object({}).strict();
export const ConfirmBookingResponseSchema = z
  .object({
    status: z.literal('submitted'),
    reference: z.string().min(1),
  })
  .strict();

export const CancelBookingRequestSchema = z.object({}).strict();
export const CancelBookingResponseSchema = z
  .object({
    status: z.literal('cancelled'),
  })
  .strict();

export const VoiceSessionEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('session.live'),
      sessionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('session.ended'),
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('ui.citations'),
      citations: z
        .array(
          z
            .object({
              sourceId: z.string().min(1),
              title: z.string().min(1),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('ui.booking.confirm'),
      draftId: z.string().min(1),
      summary: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('ui.booking.submitted'),
      draftId: z.string().min(1),
      status: z.literal('submitted'),
      reference: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('ui.escalation.created'),
      ticketRef: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('ui.error'),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
]);

export const ApiErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        requestId: z.string().min(1),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

export const SearchKnowledgeArgumentsSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe(
        'Send a concise query in the caller’s language. Preserve the exact named subject, course or service and the caller’s intent; remove conversational filler and repetition. Preserve numbers and negation, and resolve references from conversation context only when needed.',
      ),
    language: LocaleSchema,
  })
  .strict();

export const CreateBookingRequestArgumentsSchema = z
  .object({
    subject: z.string().trim().min(1).max(120),
    level: z.string().trim().min(1).max(80),
    preferredTimes: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
    timezone: z.string().trim().min(1).max(64),
    contactName: z.string().trim().min(1).max(120),
    contactPhone: z.string().trim().min(1).max(40).optional(),
    contactEmail: z.email().optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    ({ contactPhone, contactEmail }) =>
      Boolean(contactPhone?.trim() || contactEmail?.trim()),
    'A phone number or email address is required.',
  );

export const ConfirmBookingArgumentsSchema = z
  .object({
    draftId: z.string().min(1),
  })
  .strict();

export const ConfirmBookingToolResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('submitted'),
      reference: z.string().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal('denied'),
      reason: z.string().min(1),
    })
    .strict(),
]);

export const CancelBookingArgumentsSchema = z
  .object({
    draftId: z.string().min(1),
  })
  .strict();

export const CancelBookingToolResultSchema = z
  .object({
    status: z.literal('cancelled'),
  })
  .strict();

export const EscalateToHumanArgumentsSchema = z
  .object({
    reason: z
      .enum([
        'out_of_scope',
        'user_requested',
        'complaint',
        'safety',
        'technical',
      ])
      .describe('Choose the main reason the caller needs human follow-up.'),
    summary: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .describe(
        'Briefly describe the issue. Include only details the team needs; do not include phone numbers, emails, or unrelated sensitive information.',
      ),
    contactConsent: z
      .literal(true)
      .describe(
        'This tool may be called only after the caller clearly says yes to being contacted by the team. The server uses the number collected when the call started or the verified account number.',
      ),
  })
  .strict();

export const EndCallArgumentsSchema = z.object({}).strict();

export const RequestAccountDetailsArgumentsSchema = z.object({}).strict();

export const CheckTutorAvailabilityArgumentsSchema = z
  .object({
    course: z.string().trim().min(1).max(120),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    timeZone: z.string().trim().min(1).max(64),
    teachingLanguage: LocaleSchema.optional(),
  })
  .strict();

export const SubmitBookingRequestSchema = z
  .object({
    tutorId: z.string().trim().min(1).max(128),
    tutorName: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(120),
    level: z.string().trim().min(1).max(80),
    sessionStart: z.iso.datetime({ offset: true }),
    sessionEnd: z.iso.datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(64),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    ({ sessionStart, sessionEnd }) =>
      new Date(sessionEnd).getTime() > new Date(sessionStart).getTime(),
    'The session end must be after the session start.',
  );

export const SubmitBookingRequestResponseSchema = z
  .object({
    status: z.literal('submitted'),
    reference: z.string().min(1),
  })
  .strict();

// Browser: the member ID typed into the secure form. The caller's phone is
// already associated with the voice session and is not resubmitted here.
export const AccountCheckRequestSchema = z
  .object({
    memberId: z.string().trim().min(1).max(128),
  })
  .strict();

// The testing website displays the coarse verification result. No customer ID
// or matched account details are returned.
export const AccountCheckResponseSchema = z
  .object({
    status: z.literal('submitted'),
    accountStatus: z.enum(['verified', 'not_registered', 'unavailable']),
  })
  .strict();

export type Locale = z.infer<typeof LocaleSchema>;
export type ConsentVersion = z.infer<typeof ConsentVersionSchema>;
export type PublicConfigResponse = z.infer<typeof PublicConfigResponseSchema>;
export type CreateVoiceSessionRequest = z.infer<
  typeof CreateVoiceSessionRequestSchema
>;
export type CreateVoiceSessionResponse = z.infer<
  typeof CreateVoiceSessionResponseSchema
>;
export type VoiceTranscriptEntry = z.infer<typeof VoiceTranscriptEntrySchema>;
export type RealtimeConnectionRequest = z.infer<
  typeof RealtimeConnectionRequestSchema
>;
export type RealtimeConnectionResponse = z.infer<
  typeof RealtimeConnectionResponseSchema
>;
export type VoiceSessionEvent = z.infer<typeof VoiceSessionEventSchema>;
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
export type SearchKnowledgeArguments = z.infer<
  typeof SearchKnowledgeArgumentsSchema
>;
export type CreateBookingRequestArguments = z.infer<
  typeof CreateBookingRequestArgumentsSchema
>;
export type ConfirmBookingArguments = z.infer<
  typeof ConfirmBookingArgumentsSchema
>;
export type CancelBookingArguments = z.infer<
  typeof CancelBookingArgumentsSchema
>;
export type CheckTutorAvailabilityArguments = z.infer<
  typeof CheckTutorAvailabilityArgumentsSchema
>;
export type SubmitBookingRequest = z.infer<typeof SubmitBookingRequestSchema>;
export type AccountCheckRequest = z.infer<typeof AccountCheckRequestSchema>;
export type EscalateToHumanArguments = z.infer<
  typeof EscalateToHumanArgumentsSchema
>;
