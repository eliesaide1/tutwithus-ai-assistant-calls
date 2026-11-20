import { z } from 'zod';

export const KNOWLEDGE_VECTOR_DIMENSIONS = 1536;

export const AdminLoginRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});

export const AdminRoleSchema = z.enum(['admin', 'editor', 'agent', 'viewer']);

export const AdminUserSchema = z.object({
  email: z.string().email(),
  role: AdminRoleSchema,
});

export const AdminUsersResponseSchema = z.object({
  users: z.array(
    AdminUserSchema.extend({
      id: z.string().min(1),
      disabled: z.boolean(),
      createdAt: z.string().datetime(),
    }),
  ),
});

export const AdminUserCreateRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  role: AdminRoleSchema,
});

export const AdminUserUpdateRequestSchema = z
  .object({
    role: AdminRoleSchema.optional(),
    disabled: z.boolean().optional(),
  })
  .refine((value) => value.role !== undefined || value.disabled !== undefined);

export const BookingStatusSchema = z.enum([
  'draft',
  'submitted',
  'confirmed',
  'cancelled',
  'handled',
]);

export const BookingRequestSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().uuid(),
  reference: z.string().min(1),
  status: BookingStatusSchema,
  subject: z.string().min(1),
  level: z.string().min(1),
  curriculum: z.string().optional(),
  tutorId: z.string().min(1).optional(),
  tutorName: z.string().min(1).optional(),
  sessionStart: z.string().datetime().optional(),
  sessionEnd: z.string().datetime().optional(),
  customerId: z.string().min(1).optional(),
  preferredTimes: z.array(z.string()),
  timezone: z.string().min(1),
  contactName: z.string().min(1).optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  notes: z.array(
    z.object({
      authorId: z.string(),
      text: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
  readBackAt: z.string().datetime().optional(),
  confirmedAt: z.string().datetime().optional(),
  confirmedVia: z.enum(['click', 'voice']).optional(),
  assigneeId: z.string().nullable().optional(),
  assignedToCurrentUser: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const BookingRequestsResponseSchema = z.object({
  bookings: z.array(BookingRequestSchema),
});

export const AdminBookingUpdateRequestSchema = z
  .object({
    status: BookingStatusSchema.optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.assigneeId !== undefined ||
      value.note !== undefined,
  );

export const EscalationReasonSchema = z.enum([
  'out_of_scope',
  'user_requested',
  'complaint',
  'safety',
  'technical',
]);

export const EscalationSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().uuid(),
  ticketRef: z.string().min(1),
  reason: EscalationReasonSchema,
  summary: z.string().min(1),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  status: z.enum(['open', 'claimed', 'resolved']),
  contactConsent: z.boolean(),
  contact: z
    .object({
      phone: z.string().optional(),
      email: z.string().email().optional(),
    })
    .optional(),
  assigneeId: z.string().nullable().optional(),
  assignedToCurrentUser: z.boolean().optional(),
  notes: z.array(
    z.object({
      authorId: z.string(),
      text: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
  slaDueAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const EscalationsResponseSchema = z.object({
  escalations: z.array(EscalationSchema),
});

export const AdminEscalationUpdateRequestSchema = z
  .object({
    action: z.enum(['claim', 'resolve', 'reopen']).optional(),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .refine((value) => value.action !== undefined || value.note !== undefined);

export const AgentSettingsSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(['draft', 'active', 'archived']),
  name: z.string().trim().min(1).max(80).optional(),
  greeting: z.record(
    z.enum(['ar-SA', 'en', 'fr']),
    z.string().trim().min(1).max(500),
  ),
  instructionTemplate: z.string().trim().min(1).max(8000),
  voice: z.enum([
    'alloy',
    'ash',
    'ballad',
    'coral',
    'echo',
    'sage',
    'shimmer',
    'verse',
    'marin',
    'cedar',
  ]),
  maxCallSec: z.number().int().min(30).max(1800),
  businessHours: z.string().trim().min(1).max(1000),
  escalation: z.object({
    hoursText: z.string().trim().min(1).max(1000),
  }),
  activatedBy: z.string().optional(),
  activatedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const AgentSettingsDraftRequestSchema = AgentSettingsSchema.omit({
  version: true,
  status: true,
  activatedBy: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    name: z.string().trim().min(1).max(80),
  })
  .strict();

export const AdminSettingsResponseSchema = z.object({
  active: AgentSettingsSchema.nullable(),
  drafts: z.array(AgentSettingsSchema),
});

export const ActivateSettingsRequestSchema = z.object({
  version: z.number().int().positive(),
});

export const AuditLogSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().min(1),
  diff: z.record(z.string(), z.unknown()),
  ipHash: z.string().optional(),
  at: z.string().datetime(),
});

export const AuditLogsResponseSchema = z.object({
  entries: z.array(AuditLogSchema),
});

export const AdminConversationSummarySchema = z.object({
  sessionId: z.string().uuid(),
  locale: z.enum(['ar-SA', 'en', 'fr']),
  status: z.enum(['active', 'ended']),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  transcriptCount: z.number().int().nonnegative(),
  customerPhone: z.string().optional(),
  flags: z.array(z.string()).optional(),
  // Missing on records saved before channels existed; those are browser calls.
  channel: z.enum(['browser', 'whatsapp']).optional(),
});

export const AdminConversationSchema = AdminConversationSummarySchema.extend({
  // The full caller number, on the detail view only. The list keeps the masked
  // customerPhone: browsing a hundred conversations never needs it, and
  // opening one is a deliberate act that the audit log records.
  callerPhone: z.string().optional(),
  transcript: z.array(
    z.object({
      speaker: z.enum(['user', 'assistant']),
      text: z.string(),
      receivedAt: z.string().datetime(),
      citations: z
        .array(z.object({ sourceId: z.string(), title: z.string() }))
        .optional(),
    }),
  ),
});

export const AdminConversationsResponseSchema = z.object({
  conversations: z.array(AdminConversationSummarySchema),
});

export const AdminAuthResponseSchema = z.object({
  user: AdminUserSchema,
  csrfToken: z.string().min(32),
});

export const KnowledgeEntrySchema = z.object({
  title: z.string().trim().min(1).max(150),
  topic: z.string().trim().min(1).max(80).default('Knowledge'),
  translationKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,80}$/)
    .default(() => `knowledge-${globalThis.crypto.randomUUID()}`),
  language: z.enum(['ar-SA', 'en', 'fr']),
  // Legacy fields remain readable; new articles need only title, language and text.
  kind: z
    .enum(['faq', 'information', 'course', 'pricing'])
    .default('information'),
  answer: z.string().trim().min(1).max(6000),
  questions: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  reviewedOn: z.iso.date().default(() => new Date().toISOString().slice(0, 10)),
  course: z
    .object({
      name: z.string().trim().min(1).max(150),
      level: z.string().trim().min(1).max(100),
      sessions: z.number().int().positive().max(1000),
    })
    .optional(),
  price: z
    .object({
      amount: z.number().nonnegative().max(1000000),
      currency: z.string().regex(/^[A-Z]{3}$/),
      unit: z.enum(['session', 'bundle', 'course']),
    })
    .optional(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;

export const KnowledgeDocumentSchema = z.object({
  entry: KnowledgeEntrySchema.optional(),
  revision: z.number().int().nonnegative().optional(),
  sourceId: z.string().uuid(),
  originalName: z.string().min(1).max(180),
  mimeType: z.enum([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]),
  language: z.enum(['ar-SA', 'en', 'fr']),
  sizeBytes: z.number().int().positive(),
  status: z.enum([
    'ready',
    'failed',
    'draft',
    'in_review',
    'approved',
    'published',
    'archived',
  ]),
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export const KnowledgeDocumentsResponseSchema = z.object({
  documents: z.array(KnowledgeDocumentSchema),
  nextCursor: z.string().uuid().optional(),
});

export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;
export type AdminRole = z.infer<typeof AdminRoleSchema>;
export type AdminAuthResponse = z.infer<typeof AdminAuthResponseSchema>;
export type AdminUser = z.infer<typeof AdminUserSchema>;
export type AdminConversation = z.infer<typeof AdminConversationSchema>;
export type AdminConversationSummary = z.infer<
  typeof AdminConversationSummarySchema
>;
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;
export type AdminManagedUser = z.infer<
  typeof AdminUsersResponseSchema
>['users'][number];
export type BookingRequest = z.infer<typeof BookingRequestSchema>;
export type AdminBookingUpdateRequest = z.infer<
  typeof AdminBookingUpdateRequestSchema
>;
export type Escalation = z.infer<typeof EscalationSchema>;
export type AdminEscalationUpdateRequest = z.infer<
  typeof AdminEscalationUpdateRequestSchema
>;
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;
export type AgentSettingsDraftRequest = z.infer<
  typeof AgentSettingsDraftRequestSchema
>;
export type AuditLogEntry = z.infer<typeof AuditLogSchema>;
