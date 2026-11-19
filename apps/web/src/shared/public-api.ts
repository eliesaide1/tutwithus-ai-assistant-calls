import {
  ApiErrorEnvelopeSchema,
  AccountCheckResponseSchema,
  CreateVoiceSessionResponseSchema,
  EndVoiceSessionResponseSchema,
  PublicConfigResponseSchema,
  RealtimeConnectionResponseSchema,
  SaveVoiceTranscriptResponseSchema,
  type VoiceTranscriptEntry,
  type CreateVoiceSessionRequest as ContractCreateVoiceSessionRequest,
  type CreateVoiceSessionResponse as ContractCreateVoiceSessionResponse,
  type PublicConfigResponse,
} from '@tutwithus/contracts';
import {
  ApiClientError,
  apiRequest,
} from '../interceptors/axiosInterceptors.js';

export type PublicConfig = PublicConfigResponse;

export type CreateVoiceSessionRequest = ContractCreateVoiceSessionRequest;

export type CreateVoiceSessionResponse = ContractCreateVoiceSessionResponse;
export type EndVoiceSessionReason = string;

export type CreateVoiceSessionInput = Omit<
  CreateVoiceSessionRequest,
  'consentAccepted'
>;

export class PublicApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'PublicApiError';
  }
}

function parsePublicConfig(value: unknown): PublicConfig {
  const parsed = PublicConfigResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new PublicApiError('Public configuration has an invalid shape.');
  }

  return parsed.data;
}

function parseVoiceSession(value: unknown): CreateVoiceSessionResponse {
  const parsed = CreateVoiceSessionResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new PublicApiError('Voice session response has an invalid shape.');
  }

  return parsed.data;
}

function parseRealtimeConnection(value: unknown): {
  sdp: string;
  greeting: string;
} {
  const parsed = RealtimeConnectionResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new PublicApiError('Voice connection response has an invalid shape.');
  }
  return parsed.data;
}

async function requestJson(
  path: string,
  config: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    bearerToken?: string;
    data?: unknown;
    signal?: AbortSignal;
    keepalive?: boolean;
  } = {},
): Promise<unknown> {
  let result: unknown;
  try {
    const response = await apiRequest<unknown>({
      url: path,
      method: config.method,
      headers: config.headers,
      bearerToken: config.bearerToken,
      data: config.data,
      signal: config.signal,
      fetchOptions: config.keepalive ? { keepalive: true } : undefined,
    });
    result = response.data;
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      if (cause.status === undefined) {
        throw new PublicApiError('The public API could not be reached.');
      }
      const parsedError = ApiErrorEnvelopeSchema.safeParse(cause.responseData);
      if (parsedError.success) {
        throw new PublicApiError(
          parsedError.data.error.message,
          cause.status,
          parsedError.data.error.code,
          parsedError.data.error.requestId,
        );
      }
      throw new PublicApiError(
        `The public API returned HTTP ${cause.status}.`,
        cause.status,
      );
    }
    throw cause;
  }

  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as unknown;
    } catch {
      throw new PublicApiError('The public API returned invalid JSON.');
    }
  }
  return result;
}

export async function getPublicConfig(
  signal?: AbortSignal,
): Promise<PublicConfig> {
  const result = await requestJson('/api/v1/public/config', { signal });
  return parsePublicConfig(result);
}

export async function createVoiceSession(
  input: CreateVoiceSessionInput,
): Promise<CreateVoiceSessionResponse> {
  const result = await requestJson('/api/v1/voice/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Timezone': input.timeZone ?? 'UTC',
    },
    data: { ...input, consentAccepted: true },
  });
  return parseVoiceSession(result);
}

export async function checkVoiceAccount(
  session: CreateVoiceSessionResponse,
  memberId: string,
): Promise<{
  status: 'submitted';
  accountStatus: 'verified' | 'not_registered' | 'unavailable';
}> {
  const result = await requestJson(
    `/api/v1/voice/sessions/${encodeURIComponent(session.sessionId)}/account-check`,
    {
      method: 'POST',
      bearerToken: session.sessionToken,
      data: { memberId },
    },
  );
  const parsed = AccountCheckResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new PublicApiError(
      'Account verification returned an invalid response.',
    );
  }
  return parsed.data;
}

export async function connectVoiceSession(
  session: CreateVoiceSessionResponse,
  sdp: string,
  signal?: AbortSignal,
): Promise<{ sdp: string; greeting: string }> {
  const result = await requestJson(
    `/api/v1/voice/sessions/${encodeURIComponent(session.sessionId)}/connect`,
    {
      method: 'POST',
      bearerToken: session.sessionToken,
      data: { sdp },
      signal,
    },
  );
  return parseRealtimeConnection(result);
}

export async function streamSaudiArabicSpeech(
  session: CreateVoiceSessionResponse,
  text: string,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const response = await apiRequest<ReadableStream<Uint8Array>>({
    url: `/api/v1/voice/sessions/${encodeURIComponent(session.sessionId)}/speech`,
    method: 'POST',
    bearerToken: session.sessionToken,
    headers: { Accept: 'audio/mpeg' },
    data: { text },
    signal,
    responseType: 'stream',
  });
  if (!response.data || typeof response.data.getReader !== 'function') {
    throw new PublicApiError('The speech service returned invalid audio.');
  }
  return response.data;
}

export async function saveVoiceTranscriptEntry(
  session: CreateVoiceSessionResponse,
  entry: VoiceTranscriptEntry,
): Promise<void> {
  const result = await requestJson(
    `/api/v1/voice/sessions/${encodeURIComponent(session.sessionId)}/transcript`,
    {
      method: 'POST',
      bearerToken: session.sessionToken,
      data: entry,
    },
  );
  if (!SaveVoiceTranscriptResponseSchema.safeParse(result).success) {
    throw new PublicApiError('Voice transcript response has an invalid shape.');
  }
}

export async function endVoiceSession(
  session: CreateVoiceSessionResponse,
  reason: EndVoiceSessionReason,
  keepalive = false,
): Promise<void> {
  const result = await requestJson(
    `/api/v1/voice/sessions/${encodeURIComponent(session.sessionId)}/end`,
    {
      method: 'POST',
      bearerToken: session.sessionToken,
      data: { reason },
      keepalive,
    },
  );
  const parsed = EndVoiceSessionResponseSchema.safeParse(result);
  if (!parsed.success) {
    throw new PublicApiError(
      'Voice session end response has an invalid shape.',
    );
  }
}
