import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetApiClientAdapter,
  useFetchBackedApiClient,
} from './api-client-test-utils.js';
import {
  connectVoiceSession,
  createVoiceSession,
  endVoiceSession,
  getPublicConfig,
  saveVoiceTranscriptEntry,
} from '../src/shared/public-api';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('public API client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    useFetchBackedApiClient();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiClientAdapter();
    fetchMock.mockReset();
  });

  it('validates the public configuration with the shared contract', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        languages: ['ar-SA', 'en', 'fr'],
        consentVersion: '2026-11-03.1',
        consentText: {
          'ar-SA': 'Arabic consent',
          en: 'English consent',
          fr: 'French consent',
        },
        maxCallSec: 300,
      }),
    );

    await expect(getPublicConfig()).resolves.toMatchObject({
      consentVersion: '2026-11-03.1',
      maxCallSec: 300,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/public/config',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('creates a call session without a transcript opt-in preference', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        sessionId: 'session-1',
        sessionToken: 'short-lived-token',
        maxDurationSec: 300,
      }),
    );

    await expect(
      createVoiceSession({
        locale: 'ar-SA',
        consentVersion: '2026-11-03.1',
      }),
    ).resolves.toMatchObject({ sessionId: 'session-1' });

    const [, options] = fetchMock.mock.calls[0]!;
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/voice/sessions');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({
      locale: 'ar-SA',
      consentVersion: '2026-11-03.1',
      consentAccepted: true,
    });
  });

  it('sends completed transcript entries with the session bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'stored' }));
    const session = {
      sessionId: '4c2b64aa-205b-43f0-a4df-e14c4c9f7688',
      sessionToken: 'short-lived-token',
      maxDurationSec: 300,
    };
    const entry = {
      eventId: 'user:item-1',
      speaker: 'user' as const,
      text: 'Hello',
    };

    await expect(
      saveVoiceTranscriptEntry(session, entry),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/voice/sessions/${session.sessionId}/transcript`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer short-lived-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(entry),
      }),
    );
  });

  it('exposes the shared API error code and request ID', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'CONFIG_UNAVAILABLE',
            message: 'Configuration is temporarily unavailable.',
            requestId: 'request-1',
          },
        },
        503,
      ),
    );

    await expect(getPublicConfig()).rejects.toMatchObject({
      message: 'Configuration is temporarily unavailable.',
      status: 503,
      code: 'CONFIG_UNAVAILABLE',
      requestId: 'request-1',
    });
  });

  it('rejects a successful response that violates the shared schema', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        sessionId: 'session-1',
        sessionToken: '',
        maxDurationSec: 300,
      }),
    );

    await expect(
      createVoiceSession({
        locale: 'en',
        consentVersion: '2026-11-03.1',
      }),
    ).rejects.toThrow('Voice session response has an invalid shape.');
  });

  it('sends the SDP offer and bearer token to the API connection endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        sdp: 'v=0\r\nanswer',
        greeting: 'Welcome to TutWithUs.',
      }),
    );
    const session = {
      sessionId: '4c2b64aa-205b-43f0-a4df-e14c4c9f7688',
      sessionToken: 'short-lived-token',
      maxDurationSec: 300,
    };

    await expect(connectVoiceSession(session, 'v=0\r\noffer')).resolves.toEqual(
      {
        sdp: 'v=0\r\nanswer',
        greeting: 'Welcome to TutWithUs.',
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/voice/sessions/${session.sessionId}/connect`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer short-lived-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ sdp: 'v=0\r\noffer' }),
      }),
    );
  });

  it('notifies the API when the visitor ends the call', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ended' }));
    const session = {
      sessionId: '4c2b64aa-205b-43f0-a4df-e14c4c9f7688',
      sessionToken: 'short-lived-token',
      maxDurationSec: 300,
    };

    await expect(
      endVoiceSession(session, 'user_ended'),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/voice/sessions/${session.sessionId}/end`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer short-lived-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ reason: 'user_ended' }),
      }),
    );
  });
});
