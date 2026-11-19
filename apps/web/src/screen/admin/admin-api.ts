import {
  ActivateSettingsRequestSchema,
  AdminAuthResponseSchema,
  AdminBookingUpdateRequestSchema,
  AdminConversationSchema,
  AdminConversationsResponseSchema,
  AdminEscalationUpdateRequestSchema,
  AdminSettingsResponseSchema,
  AdminUserCreateRequestSchema,
  AdminUserUpdateRequestSchema,
  AdminUsersResponseSchema,
  AgentSettingsDraftRequestSchema,
  AgentSettingsSchema,
  AuditLogsResponseSchema,
  BookingRequestsResponseSchema,
  EscalationsResponseSchema,
  KnowledgeDocumentSchema,
  KnowledgeDocumentsResponseSchema,
  KnowledgeEntrySchema,
  type KnowledgeEntry,
  type AdminAuthResponse,
  type AdminConversation,
  type AdminConversationSummary,
  type AdminManagedUser,
  type AgentSettings,
  type AgentSettingsDraftRequest,
  type AuditLogEntry,
  type BookingRequest,
  type Escalation,
  type KnowledgeDocument,
} from '@tutwithus/contracts/admin';
import type { Locale } from '@tutwithus/contracts';
import type { AxiosResponse } from 'axios';
import {
  ApiClientError,
  apiRequest,
} from '../../interceptors/axiosInterceptors.js';

const ADMIN_API = '/api/v1/admin';

export async function saveKnowledgeEntry(
  entry: KnowledgeEntry,
  csrfToken: string,
  edit?: { sourceId: string; revision: number },
): Promise<KnowledgeDocument> {
  const data = KnowledgeEntrySchema.parse(entry);
  return readResponse(
    apiRequest({
      url: `${ADMIN_API}/knowledge/entries${edit ? `/${encodeURIComponent(edit.sourceId)}` : ''}`,
      method: edit ? 'PUT' : 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      data: edit ? { entry: data, revision: edit.revision } : data,
    }),
    KnowledgeDocumentSchema,
  );
}

export type AdminUiError =
  | { type: 'session' }
  | { type: 'request' }
  | { type: 'message'; message: string };

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export function isAdminSessionError(cause: unknown): cause is AdminApiError {
  return (
    cause instanceof AdminApiError &&
    cause.status === 401 &&
    cause.code === 'ADMIN_UNAUTHORIZED'
  );
}

async function readResponse<T>(
  request: Promise<AxiosResponse<unknown>>,
  schema: { parse(value: unknown): T },
): Promise<T> {
  let response: Awaited<typeof request>;
  try {
    response = await request;
  } catch (cause) {
    if (!(cause instanceof ApiClientError) || cause.status === undefined) {
      throw cause;
    }

    let message = cause.message;
    if (typeof cause.responseData === 'string') {
      try {
        JSON.parse(cause.responseData);
      } catch {
        const diagnostic = cause.requestId
          ? ` Request ID: ${cause.requestId}.`
          : '';
        message = `The server returned HTTP ${cause.status} without a valid JSON error. Check that the API service is running.${diagnostic}`;
      }
    }
    throw new AdminApiError(message, cause.status, cause.code);
  }

  if (response.data === undefined || response.data === '') {
    throw new AdminApiError(
      `The server returned an empty response (HTTP ${response.status}).`,
      response.status,
    );
  }
  if (typeof response.data === 'string') {
    try {
      response.data = JSON.parse(response.data) as unknown;
    } catch {
      const requestId = response.headers['x-request-id'];
      const diagnostic =
        typeof requestId === 'string' ? ` Request ID: ${requestId}.` : '';
      throw new AdminApiError(
        `The server returned an invalid response (HTTP ${response.status}).${diagnostic}`,
        response.status,
      );
    }
  }
  try {
    return schema.parse(response.data);
  } catch {
    throw new AdminApiError(
      `The server response did not match the expected format (HTTP ${response.status}).`,
      response.status,
    );
  }
}

export async function adminLogin(
  email: string,
  password: string,
): Promise<AdminAuthResponse> {
  return readResponse(
    apiRequest({
      url: `${ADMIN_API}/auth/login`,
      method: 'POST',
      data: { email, password },
    }),
    AdminAuthResponseSchema,
  );
}

export async function loadAdminSession(): Promise<AdminAuthResponse | null> {
  try {
    return await readResponse(
      apiRequest({ url: `${ADMIN_API}/auth/me` }),
      AdminAuthResponseSchema,
    );
  } catch (cause) {
    if (isAdminSessionError(cause)) {
      return null;
    }
    throw cause;
  }
}

export async function adminLogout(csrfToken: string): Promise<void> {
  await readResponse(
    apiRequest({
      url: `${ADMIN_API}/auth/logout`,
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
    }),
    {
      parse(value) {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('status' in value) ||
          value.status !== 'logged_out'
        ) {
          throw new Error('The server returned an invalid logout response.');
        }
        return undefined;
      },
    },
  );
}

export async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const documents = new Map<string, KnowledgeDocument>();
  const cursors = new Set<string>();
  let after: string | undefined;
  do {
    const page = await readResponse(
      apiRequest({
        url: `${ADMIN_API}/knowledge/documents${after ? `?after=${encodeURIComponent(after)}` : ''}`,
      }),
      KnowledgeDocumentsResponseSchema,
    );
    for (const document of page.documents)
      documents.set(document.sourceId, document);
    after = page.nextCursor;
    if (after && cursors.has(after))
      throw new Error(
        'Knowledge pagination repeated a cursor. Please refresh.',
      );
    if (after) cursors.add(after);
  } while (after);
  return [...documents.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export async function listAdminConversations(
  filter: {
    locale?: Locale;
    status?: 'active' | 'ended';
  } = {},
): Promise<AdminConversationSummary[]> {
  const query = new URLSearchParams();
  if (filter.locale) {
    query.set('locale', filter.locale);
  }
  if (filter.status) {
    query.set('status', filter.status);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return (
    await readResponse(
      apiRequest({ url: `${ADMIN_API}/conversations${suffix}` }),
      AdminConversationsResponseSchema,
    )
  ).conversations;
}

export async function getAdminConversation(
  sessionId: string,
): Promise<AdminConversation> {
  return readResponse(
    apiRequest({
      url: `${ADMIN_API}/conversations/${encodeURIComponent(sessionId)}`,
    }),
    AdminConversationSchema,
  );
}

export async function updateKnowledgeDocumentStatus(
  sourceId: string,
  status: 'in_review' | 'draft' | 'approved' | 'published' | 'archived',
  csrfToken: string,
): Promise<void> {
  await readResponse(
    apiRequest({
      url: `${ADMIN_API}/knowledge/documents/${encodeURIComponent(sourceId)}/status`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      data: { status },
    }),
    {
      parse(value) {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('status' in value) ||
          value.status !== status
        ) {
          throw new Error('The server returned an invalid status response.');
        }
        return undefined;
      },
    },
  );
}

function adminJsonHeaders(csrfToken?: string) {
  return {
    'Content-Type': 'application/json',
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  };
}

export async function listBookingRequests(
  status?: BookingRequest['status'],
): Promise<BookingRequest[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return (
    await readResponse(
      apiRequest({ url: `${ADMIN_API}/booking-requests${query}` }),
      BookingRequestsResponseSchema,
    )
  ).bookings;
}

export async function updateBookingRequest(
  id: string,
  update: {
    status?: BookingRequest['status'];
    assigneeId?: string | null;
    note?: string;
  },
  csrfToken: string,
): Promise<void> {
  const body = AdminBookingUpdateRequestSchema.parse(update);
  await readResponse(
    apiRequest({
      url: `${ADMIN_API}/booking-requests/${encodeURIComponent(id)}`,
      method: 'PATCH',
      headers: adminJsonHeaders(csrfToken),
      data: body,
    }),
    { parse: () => undefined },
  );
}

export async function listEscalations(
  filter: {
    status?: Escalation['status'];
    priority?: Escalation['priority'];
  } = {},
): Promise<Escalation[]> {
  const query = new URLSearchParams();
  if (filter.status) {
    query.set('status', filter.status);
  }
  if (filter.priority) {
    query.set('priority', filter.priority);
  }
  const suffix = query.size > 0 ? `?${query}` : '';
  return (
    await readResponse(
      apiRequest({ url: `${ADMIN_API}/escalations${suffix}` }),
      EscalationsResponseSchema,
    )
  ).escalations;
}

export async function updateEscalation(
  id: string,
  update: { action?: 'claim' | 'resolve' | 'reopen'; note?: string },
  csrfToken: string,
): Promise<void> {
  const body = AdminEscalationUpdateRequestSchema.parse(update);
  await readResponse(
    apiRequest({
      url: `${ADMIN_API}/escalations/${encodeURIComponent(id)}`,
      method: 'PATCH',
      headers: adminJsonHeaders(csrfToken),
      data: body,
    }),
    { parse: () => undefined },
  );
}

export async function getAdminSettings(): Promise<{
  active: AgentSettings | null;
  drafts: AgentSettings[];
}> {
  return readResponse(
    apiRequest({ url: `${ADMIN_API}/settings` }),
    AdminSettingsResponseSchema,
  );
}

export async function saveAgentSettingsDraft(
  settings: AgentSettingsDraftRequest,
  csrfToken: string,
): Promise<AgentSettings> {
  const body = AgentSettingsDraftRequestSchema.parse(settings);
  return readResponse(
    apiRequest({
      url: `${ADMIN_API}/settings/draft`,
      method: 'PUT',
      headers: adminJsonHeaders(csrfToken),
      data: body,
    }),
    AgentSettingsSchema,
  );
}

export async function updateAgentSettingsDraft(
  version: number,
  settings: AgentSettingsDraftRequest,
  csrfToken: string,
): Promise<AgentSettings> {
  const body = AgentSettingsDraftRequestSchema.parse(settings);
  return readResponse(
    apiRequest({
      url: `${ADMIN_API}/settings/draft/${version}`,
      method: 'PUT',
      headers: adminJsonHeaders(csrfToken),
      data: body,
    }),
    AgentSettingsSchema,
  );
}

export async function deleteAgentSettingsDraft(
  version: number,
  csrfToken: string,
): Promise<void> {
  await readResponse(
    apiRequest({
      url: `${ADMIN_API}/settings/draft/${version}`,
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken },
    }),
    {
      parse(value) {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('status' in value) ||
          value.status !== 'deleted' ||
          !('version' in value) ||
          value.version !== version
        ) {
          throw new Error('The server returned an invalid delete response.');
        }
      },
    },
  );
}

export async function activateAgentSettings(
  version: number,
  csrfToken: string,
): Promise<void> {
  const body = ActivateSettingsRequestSchema.parse({ version });
  await readResponse(
    apiRequest({
      url: `${ADMIN_API}/settings/activate`,
      method: 'POST',
      headers: adminJsonHeaders(csrfToken),
      data: body,
    }),
    {
      parse(value) {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('status' in value) ||
          value.status !== 'active'
        ) {
          throw new Error(
            'The server returned an invalid activation response.',
          );
        }
        return undefined;
      },
    },
  );
}

export async function listAdminUsers(): Promise<AdminManagedUser[]> {
  return (
    await readResponse(
      apiRequest({ url: `${ADMIN_API}/users` }),
      AdminUsersResponseSchema,
    )
  ).users;
}

export async function createAdminUser(
  input: { email: string; password: string; role: AdminManagedUser['role'] },
  csrfToken: string,
): Promise<AdminManagedUser> {
  const body = AdminUserCreateRequestSchema.parse(input);
  return readResponse(
    apiRequest({
      url: `${ADMIN_API}/users`,
      method: 'POST',
      headers: adminJsonHeaders(csrfToken),
      data: body,
    }),
    AdminUsersResponseSchema.shape.users.element,
  );
}

export async function updateAdminUser(
  id: string,
  update: { role?: AdminManagedUser['role']; disabled?: boolean },
  csrfToken: string,
): Promise<AdminManagedUser> {
  const body = AdminUserUpdateRequestSchema.parse(update);
  return readResponse(
    apiRequest({
      url: `${ADMIN_API}/users/${encodeURIComponent(id)}`,
      method: 'PATCH',
      headers: adminJsonHeaders(csrfToken),
      data: body,
    }),
    AdminUsersResponseSchema.shape.users.element,
  );
}

export async function deleteAdminUser(
  id: string,
  csrfToken: string,
): Promise<void> {
  await readResponse(
    apiRequest({
      url: `${ADMIN_API}/users/${encodeURIComponent(id)}`,
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken },
    }),
    {
      parse(value) {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('status' in value) ||
          value.status !== 'deleted'
        ) {
          throw new Error('The server returned an invalid delete response.');
        }
        return undefined;
      },
    },
  );
}

export async function listAdminAudit(
  filter: {
    entity?: string;
    entityId?: string;
    limit?: number;
  } = {},
): Promise<AuditLogEntry[]> {
  const query = new URLSearchParams();
  if (filter.entity) {
    query.set('entity', filter.entity);
  }
  if (filter.entityId) {
    query.set('entityId', filter.entityId);
  }
  if (filter.limit !== undefined) {
    query.set('limit', String(filter.limit));
  }
  const suffix = query.size > 0 ? `?${query}` : '';
  return (
    await readResponse(
      apiRequest({ url: `${ADMIN_API}/audit${suffix}` }),
      AuditLogsResponseSchema,
    )
  ).entries;
}

export async function uploadKnowledgeDocument(
  file: File,
  language: Locale,
  csrfToken: string,
): Promise<KnowledgeDocument> {
  const form = new FormData();
  form.append('file', file);
  form.append('language', language);
  return readResponse(
    apiRequest({
      url: `${ADMIN_API}/knowledge/documents`,
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      data: form,
    }),
    KnowledgeDocumentSchema,
  );
}

export async function deleteKnowledgeDocument(
  sourceId: string,
  csrfToken: string,
): Promise<void> {
  await readResponse(
    apiRequest({
      url: `${ADMIN_API}/knowledge/documents/${encodeURIComponent(sourceId)}`,
      method: 'DELETE',
      headers: { 'X-CSRF-Token': csrfToken },
    }),
    {
      parse(value) {
        if (
          typeof value !== 'object' ||
          value === null ||
          !('status' in value) ||
          value.status !== 'deleted'
        ) {
          throw new Error('The server returned an invalid delete response.');
        }
        return undefined;
      },
    },
  );
}
