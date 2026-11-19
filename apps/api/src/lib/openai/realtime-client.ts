import OpenAI, { APIError } from 'openai';
import { OpenAIRealtimeError } from 'openai/realtime/index';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import {
  DEFAULT_SERVER_VAD,
  type RealtimeSessionConfiguration,
} from '../../core/session/realtime-session-config.js';
import { errorName } from '../logger.js';
import type {
  RealtimeServerEvent,
  RealtimeSideband,
  SidebandCloseInfo,
  SidebandHandlers,
} from '../../core/session/session-ports.js';

export type RealtimeCallRequest = {
  sdp: string;
  model: string;
  session: RealtimeSessionConfiguration;
};

export type RealtimeCallAnswer = {
  sdp: string;
  // OpenAI's ID for the call; needed to attach the sideband and to hang up.
  callId: string;
};

export interface RealtimeProvider {
  createCall(
    request: RealtimeCallRequest,
    signal?: AbortSignal,
  ): Promise<RealtimeCallAnswer>;
  // Attaches the server-side control connection to a call. Resolves once open.
  openSideband(
    callId: string,
    handlers: SidebandHandlers,
  ): Promise<RealtimeSideband>;
  hangup(callId: string): Promise<void>;
}

export class RealtimeProviderError extends Error {
  readonly providerDetails: {
    status?: number;
    code?: string;
    param?: string;
    type?: string;
    requestId?: string;
    message?: string;
  };
  readonly offerDiagnostics?: ReturnType<typeof summarizeSdpOffer>;

  constructor(
    message: string,
    options?: ErrorOptions,
    offerDiagnostics?: ReturnType<typeof summarizeSdpOffer>,
  ) {
    super(message, options);
    this.name = 'RealtimeProviderError';
    this.offerDiagnostics = offerDiagnostics;
    const cause = options?.cause;
    const providerMessage =
      cause instanceof APIError ? safeProviderMessage(cause) : undefined;
    this.providerDetails =
      cause instanceof APIError
        ? {
            ...(typeof cause.status === 'number'
              ? { status: cause.status }
              : {}),
            ...(typeof cause.code === 'string' ? { code: cause.code } : {}),
            ...(typeof cause.param === 'string' ? { param: cause.param } : {}),
            ...(typeof cause.type === 'string' ? { type: cause.type } : {}),
            ...(typeof cause.requestID === 'string'
              ? { requestId: cause.requestID }
              : {}),
            ...(providerMessage ? { message: providerMessage } : {}),
          }
        : {};
  }
}

function safeProviderMessage(error: APIError): string | undefined {
  const body: unknown = error.error;
  if (
    typeof body !== 'object' ||
    body === null ||
    !('message' in body) ||
    typeof body.message !== 'string'
  ) {
    return undefined;
  }
  const message = body.message
    .replace(
      /\b(?:a=)?(?:ice-ufrag|ice-pwd|candidate|fingerprint):[^\s,;]+/gi,
      '[SDP value]',
    )
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|rk|sess)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return message || undefined;
}

function summarizeSdpOffer(sdp: string) {
  const lines = sdp.split(/\r?\n/);
  const count = (pattern: RegExp) =>
    lines.filter((line) => pattern.test(line)).length;
  return {
    lengthBytes: Buffer.byteLength(sdp),
    lineCount: lines.filter(Boolean).length,
    endsWithCrlf: sdp.endsWith('\r\n'),
    containsLfOnly: /(?<!\r)\n/.test(sdp),
    hasVersionLine: lines.includes('v=0'),
    hasOriginLine: lines.some((line) => line.startsWith('o=')),
    hasSessionNameLine: lines.some((line) => line.startsWith('s=')),
    hasTimingLine: lines.some((line) => line.startsWith('t=')),
    audioMediaCount: count(/^m=audio\s/),
    dataChannelMediaCount: count(/^m=application\s/),
    iceUfragCount: count(/^a=ice-ufrag:/),
    icePasswordCount: count(/^a=ice-pwd:/),
    fingerprintCount: count(/^a=fingerprint:/),
    candidateCount: count(/^a=candidate:/),
    endOfCandidatesCount: count(/^a=end-of-candidates$/),
  };
}

function normalizeSdpLineEndings(sdp: string): string {
  const normalized = sdp.replace(/\r\n|\n|\r/g, '\r\n');
  return normalized.endsWith('\r\n') ? normalized : `${normalized}\r\n`;
}

const SIDEBAND_OPEN_TIMEOUT_MS = 5_000;
// Resource name in the Location header: /v1/realtime/calls/<call id>
const CALL_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function parseCallId(locationHeader: string | null): string | undefined {
  const segment = locationHeader?.split('/').filter(Boolean).at(-1);
  return segment && CALL_ID_PATTERN.test(segment) ? segment : undefined;
}

export class OpenAIRealtimeClient implements RealtimeProvider {
  constructor(private readonly apiKey: string | undefined) {}

  private client(timeoutMs: number): OpenAI {
    if (!this.apiKey) {
      throw new RealtimeProviderError('OpenAI API key is not configured.');
    }
    return new OpenAI({
      apiKey: this.apiKey,
      maxRetries: 0,
      timeout: timeoutMs,
    });
  }

  async createCall(
    request: RealtimeCallRequest,
    signal?: AbortSignal,
  ): Promise<RealtimeCallAnswer> {
    const client = this.client(15_000);

    try {
      const result = await client.realtime.calls.create(
        {
          sdp: normalizeSdpLineEndings(request.sdp),
          session: {
            type: 'realtime',
            model: request.model,
            instructions: request.session.instructions,
            output_modalities: request.session.outputModalities,
            audio: {
              input: {
                transcription: { model: request.session.transcriptionModel },
                noise_reduction: request.session.inputNoiseReduction ?? {
                  type: 'far_field',
                },
                turn_detection:
                  request.session.turnDetection ?? DEFAULT_SERVER_VAD,
              },
              output: { voice: request.session.voice },
            },
            ...(request.session.tools
              ? { tools: request.session.tools, tool_choice: 'auto' as const }
              : {}),
          },
        },
        { signal },
      );

      const callId = parseCallId(result.headers.get('location'));
      if (!callId) {
        throw new RealtimeProviderError(
          'OpenAI did not return a call ID for the voice session.',
        );
      }
      return { sdp: await result.text(), callId };
    } catch (error) {
      if (error instanceof APIError) {
        throw new RealtimeProviderError(
          'OpenAI could not create the voice session.',
          { cause: error },
          summarizeSdpOffer(request.sdp),
        );
      }

      throw error;
    }
  }

  openSideband(
    callId: string,
    handlers: SidebandHandlers,
  ): Promise<RealtimeSideband> {
    const connection = new OpenAIRealtimeWS(
      { callID: callId },
      this.client(15_000),
    );
    let opened = false;
    let closedReported = false;
    const reportClosed = (details?: SidebandCloseInfo) => {
      if (!closedReported) {
        closedReported = true;
        handlers.onClosed(details);
      }
    };

    return new Promise<RealtimeSideband>((resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.close();
        reject(
          new RealtimeProviderError('The voice control connection timed out.'),
        );
      }, SIDEBAND_OPEN_TIMEOUT_MS);

      connection.socket.once('open', () => {
        opened = true;
        clearTimeout(timeout);
        resolve({
          send: (event) =>
            connection.send(
              event as unknown as Parameters<typeof connection.send>[0],
            ),
          close: () => connection.close(),
        });
      });
      connection.on('event', (event) => {
        handlers.onEvent(event as unknown as RealtimeServerEvent);
      });
      // Before the socket opens a failure rejects the promise; afterwards it
      // means the control connection was lost.
      connection.on('error', (error) => {
        if (!opened) {
          clearTimeout(timeout);
          reject(
            new RealtimeProviderError('The voice control connection failed.', {
              cause: error,
            }),
          );
          return;
        }
        if (error instanceof OpenAIRealtimeError && error.error) {
          return;
        }
        reportClosed({ errorName: errorName(error) });
      });
      connection.socket.on('close', (code: number, reason: Buffer) => {
        if (!opened) {
          clearTimeout(timeout);
          reject(
            new RealtimeProviderError('The voice control connection closed.'),
          );
          return;
        }
        reportClosed({
          ...(typeof code === 'number' ? { closeCode: code } : {}),
          ...(Buffer.isBuffer(reason) && reason.length > 0
            ? { reasonLength: reason.length }
            : {}),
        });
      });
    });
  }

  async hangup(callId: string): Promise<void> {
    try {
      await this.client(10_000).realtime.calls.hangup(callId);
    } catch (error) {
      if (error instanceof APIError && error.status === 404) {
        // The call already ended on the provider side.
        return;
      }
      throw error;
    }
  }
}
