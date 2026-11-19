import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIRealtimeError } from 'openai/realtime/index';
import { OpenAIRealtimeClient } from './realtime-client.js';

const realtimeMock = vi.hoisted(() => ({
  openSocket: (): void => {},
  emitError: (_error: unknown): void => {},
}));

vi.mock('openai/realtime/ws', async () => {
  const { EventEmitter } = await import('node:events');

  class MockRealtimeWebSocket extends EventEmitter {
    readonly socket = new EventEmitter();

    constructor() {
      super();
      realtimeMock.openSocket = () => this.socket.emit('open');
      realtimeMock.emitError = (error) => this.emit('error', error);
    }

    send(): void {}

    close(): void {}
  }

  return { OpenAIRealtimeWS: MockRealtimeWebSocket };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('normalizes SDP line endings and adds the required final CRLF', async () => {
  let sentSdp = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (!(init?.body instanceof FormData)) {
        throw new Error('Expected the OpenAI multipart request body.');
      }
      const sdpPart = init.body.get('sdp');
      if (!(sdpPart instanceof Blob)) {
        throw new Error('Expected the SDP offer in the multipart request.');
      }
      sentSdp = await sdpPart.text();
      return new Response('v=0\r\nanswer\r\n', {
        status: 201,
        headers: {
          'content-type': 'application/sdp',
          location: '/v1/realtime/calls/rtc_test_call',
        },
      });
    }),
  );

  await new OpenAIRealtimeClient('test-api-key').createCall({
    sdp: 'v=0\no=- 1 1 IN IP4 127.0.0.1',
    model: 'gpt-realtime-2.1-mini',
    session: {
      instructions: 'Test instructions',
      outputModalities: ['audio'],
      transcriptionModel: 'gpt-transcribe',
      voice: 'marin',
    },
  });

  expect(sentSdp).toBe('v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n');
});

describe('OpenAI Realtime WebRTC client', () => {
  it('does not close the call for a recoverable Realtime API error', async () => {
    const handlers = { onEvent: vi.fn(), onClosed: vi.fn() };
    const sidebandPromise = new OpenAIRealtimeClient(
      'test-api-key',
    ).openSideband('rtc_test_call', handlers);
    realtimeMock.openSocket();
    const sideband = await sidebandPromise;

    realtimeMock.emitError(
      new OpenAIRealtimeError('The Realtime API rejected an event.', {
        type: 'error',
        event_id: 'evt_error',
        error: {
          type: 'invalid_request_error',
          message: 'Invalid session update',
          code: 'invalid_value',
          event_id: 'evt_update',
          param: 'session.tools',
        },
      }),
    );

    expect(handlers.onClosed).not.toHaveBeenCalled();
    sideband.close();
  });

  it('summarizes rejected SDP offers without retaining network or ICE values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'Offer rejected a=ice-ufrag:secret-ufrag at 192.0.2.1',
                code: 'invalid_offer',
                type: 'invalid_request_error',
              },
            }),
            {
              status: 400,
              headers: {
                'content-type': 'application/json',
                'x-request-id': 'req_invalid_offer',
              },
            },
          ),
      ),
    );

    const sdp = [
      'v=0',
      'o=- 123 1 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=ice-ufrag:secret-ufrag',
      'a=ice-pwd:secret-password',
      'a=fingerprint:sha-256 private-fingerprint',
      'a=candidate:1 1 UDP 123 192.0.2.1 54321 typ host',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      '',
    ].join('\r\n');

    const provider = new OpenAIRealtimeClient('test-api-key');

    const error = await provider
      .createCall({
        sdp,
        model: 'gpt-realtime-2.1-mini',
        session: {
          instructions: 'Test instructions',
          outputModalities: ['audio'],
          transcriptionModel: 'gpt-transcribe',
          voice: 'marin',
        },
      })
      .catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      providerDetails: {
        status: 400,
        code: 'invalid_offer',
        requestId: 'req_invalid_offer',
        message: 'Offer rejected [SDP value] at [IP]',
      },
      offerDiagnostics: {
        hasVersionLine: true,
        hasOriginLine: true,
        hasSessionNameLine: true,
        hasTimingLine: true,
        audioMediaCount: 1,
        dataChannelMediaCount: 1,
        iceUfragCount: 1,
        icePasswordCount: 1,
        fingerprintCount: 1,
        candidateCount: 1,
      },
    });
    const serializedError = JSON.stringify(error);
    expect(serializedError).not.toContain('secret-ufrag');
    expect(serializedError).not.toContain('secret-password');
    expect(serializedError).not.toContain('192.0.2.1');
    expect(serializedError).not.toContain('private-fingerprint');
  });

  it('creates a Realtime call with the configured model and Marin voice', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const requestUrl = input instanceof Request ? input.url : String(input);
        expect(requestUrl).toContain('/v1/realtime/calls');
        expect(init?.method).toBe('POST');
        const headers = new Headers(
          input instanceof Request ? input.headers : init?.headers,
        );
        expect(headers.get('authorization')).toBe('Bearer test-api-key');

        const body = init?.body;
        if (!(body instanceof FormData)) {
          throw new Error('Expected the OpenAI multipart request body.');
        }
        const sdpPart = body.get('sdp');
        if (!(sdpPart instanceof Blob)) {
          throw new Error('Expected the SDP offer in the multipart request.');
        }
        expect(await sdpPart.text()).toBe('v=0\r\noffer\r\n');
        const sessionPart = body.get('session');
        if (!(sessionPart instanceof Blob)) {
          throw new Error('Expected a JSON Realtime session configuration.');
        }
        expect(JSON.parse(await sessionPart.text())).toMatchObject({
          type: 'realtime',
          model: 'gpt-realtime-2.1-mini',
          instructions: 'Test instructions',
          output_modalities: ['audio'],
          audio: {
            input: {
              transcription: { model: 'gpt-transcribe' },
              noise_reduction: { type: 'far_field' },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.8,
                prefix_padding_ms: 300,
                silence_duration_ms: 500,
                create_response: false,
              },
            },
            output: { voice: 'marin' },
          },
        });

        return new Response('v=0\r\nanswer', {
          status: 201,
          headers: {
            'content-type': 'application/sdp',
            location: '/v1/realtime/calls/rtc_test_call',
          },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIRealtimeClient('test-api-key');
    const answer = await provider.createCall({
      sdp: 'v=0\r\noffer',
      model: 'gpt-realtime-2.1-mini',
      session: {
        instructions: 'Test instructions',
        outputModalities: ['audio'],
        transcriptionModel: 'gpt-transcribe',
        voice: 'marin',
      },
    });

    expect(answer).toEqual({ sdp: 'v=0\r\nanswer', callId: 'rtc_test_call' });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not expose provider credential errors to API callers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'invalid test-api-key',
                code: 'invalid_api_key',
                type: 'authentication_error',
              },
            }),
            {
              status: 401,
              headers: {
                'content-type': 'application/json',
                'x-request-id': 'req_test_realtime',
              },
            },
          ),
      ),
    );

    const provider = new OpenAIRealtimeClient('test-api-key');

    await expect(
      provider.createCall({
        sdp: 'v=0\r\noffer',
        model: 'gpt-realtime-2.1-mini',
        session: {
          instructions: 'Test instructions',
          outputModalities: ['audio'],
          transcriptionModel: 'gpt-transcribe',
          voice: 'marin',
        },
      }),
    ).rejects.toMatchObject({
      name: 'RealtimeProviderError',
      message: 'OpenAI could not create the voice session.',
      providerDetails: {
        status: 401,
        code: 'invalid_api_key',
        type: 'authentication_error',
        requestId: 'req_test_realtime',
      },
    });
  });

  it('handles exhausted-credit responses without exposing provider details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'The project has no remaining credits.',
                type: 'insufficient_quota',
                code: 'insufficient_quota',
              },
            }),
            {
              status: 429,
              headers: { 'content-type': 'application/json' },
            },
          ),
      ),
    );

    const provider = new OpenAIRealtimeClient('test-api-key');

    await expect(
      provider.createCall({
        sdp: 'v=0\r\noffer',
        model: 'gpt-realtime-2.1-mini',
        session: {
          instructions: 'Test instructions',
          outputModalities: ['audio'],
          transcriptionModel: 'gpt-transcribe',
          voice: 'marin',
        },
      }),
    ).rejects.toMatchObject({
      name: 'RealtimeProviderError',
      message: 'OpenAI could not create the voice session.',
    });
  });
});
