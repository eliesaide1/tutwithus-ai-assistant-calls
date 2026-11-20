import { createLogger } from '../../lib/logger.js';
import { describe, expect, it, vi } from 'vitest';
import { ActiveCallRegistry } from '../../core/session/active-calls.js';
import type { RealtimeServerEvent } from '../../core/session/session-ports.js';
import { ToolGateway } from '../../core/tools/tool-gateway.js';
import { createGetMyWalletTool } from '../../core/tools/handlers/voice-tools.js';
import { createOpaqueToken } from '../../lib/tokens.js';
import { RealtimeProviderError } from '../../lib/openai/realtime-client.js';
import type { RealtimeProvider } from '../../lib/openai/realtime-client.js';
import type { VoiceSessionRecord } from '../../modules/voice-sessions/voice-session.repository.js';
import type { VoiceSessionRepository } from '../../modules/voice-sessions/voice-session.repository.js';
import {
  connectBrowserVoiceSession,
  type BrowserVoiceDeps,
} from './browser-voice-transport.js';

const logger = createLogger({ level: 'silent', service: 'transport-test' });

function createSetup(
  options: {
    openSideband?: RealtimeProvider['openSideband'];
    acquire?: boolean;
    locale?: VoiceSessionRecord['locale'];
    startCall?: boolean;
    callerAccountStatus?: VoiceSessionRecord['callerAccountStatus'];
    memberVerificationAvailable?: boolean;
    tools?: ToolGateway;
  } = {},
) {
  const token = createOpaqueToken();
  const now = new Date();
  const record: VoiceSessionRecord = {
    sessionId: '44f887b3-14b8-4f82-a18f-69e5d8215c7c',
    locale: options.locale ?? 'en',
    consentVersion: '2026-11-04.1',
    consentAccepted: true,
    transcript: [],
    sessionTokenHash: token.hash,
    acceptedAt: now,
    tokenExpiresAt: new Date(now.getTime() + 600_000),
    expiresAt: new Date(now.getTime() + 86_400_000),
    maxDurationSec: 300,
    ...(options.callerAccountStatus
      ? { callerAccountStatus: options.callerAccountStatus }
      : {}),
    ...(options.memberVerificationAvailable !== undefined
      ? { memberVerificationAvailable: options.memberVerificationAvailable }
      : {}),
  };
  const repository = {
    findBySessionId: vi.fn(async () => record),
    startCall: vi.fn(async () => options.startCall ?? true),
    endCall: vi.fn(async () => undefined),
    attachProviderCall: vi.fn(async () => undefined),
    recordCallOutcome: vi.fn(async () => undefined),
    appendTranscript: vi.fn(async () => true),
  };
  const sideband = { send: vi.fn(), close: vi.fn() };
  const sidebandHandlers: Array<
    Parameters<RealtimeProvider['openSideband']>[1]
  > = [];
  const provider = {
    createCall: vi.fn(async () => ({ sdp: 'answer', callId: 'rtc_1' })),
    openSideband: vi.fn<RealtimeProvider['openSideband']>(
      options.openSideband ??
        (async (_callId, handlers) => {
          sidebandHandlers.push(handlers);
          return sideband;
        }),
    ),
    hangup: vi.fn(async () => undefined),
  };
  const liveCalls = {
    acquire: vi.fn(async () => options.acquire ?? true),
    release: vi.fn(async () => undefined),
  };
  const activeCalls = new ActiveCallRegistry();
  const deps: BrowserVoiceDeps = {
    config: {
      maxCallSec: 300,
      idleTimeoutSec: 30,
      openai: {
        apiKey: 'test-key',
        realtimeModel: 'test-model',
        embeddingModel: 'test-embedding',
        turnDetection: {
          type: 'server_vad',
          threshold: 0.8,
          silence_duration_ms: 500,
          prefix_padding_ms: 300,
          create_response: false,
        },
      },
    },
    repository: repository as unknown as VoiceSessionRepository,
    settingsReader: { getActiveAgentSettings: vi.fn(async () => null) },
    provider,
    tools:
      options.tools ??
      new ToolGateway([], { record: async () => undefined }, logger),
    liveCalls,
    activeCalls,
    logger,
  };
  const input = {
    sessionId: record.sessionId,
    sessionToken: token.token,
    sdp: 'offer',
  };
  return {
    deps,
    input,
    repository,
    provider,
    liveCalls,
    activeCalls,
    sideband,
    sidebandHandlers,
  };
}

describe('connectBrowserVoiceSession', () => {
  it('creates the call, attaches the control connection and returns the answer', async () => {
    const t = createSetup();
    const answer = await connectBrowserVoiceSession(t.deps, t.input);

    expect(answer).toEqual({
      sdp: 'answer',
      greeting: 'Thank you for calling TutWithUs. How may I help you today?',
    });
    expect(t.provider.createCall).toHaveBeenCalledOnce();
    expect(t.repository.attachProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({ providerCallId: 'rtc_1' }),
    );
    expect(t.provider.openSideband).toHaveBeenCalledWith(
      'rtc_1',
      expect.any(Object),
    );
    expect(t.activeCalls.size).toBe(1);
    expect(t.liveCalls.release).not.toHaveBeenCalled();
  });

  it('opens the control connection before the browser gets the answer', async () => {
    const t = createSetup();
    const order: string[] = [];
    t.provider.createCall.mockImplementation(async () => {
      order.push('createCall');
      return { sdp: 'answer', callId: 'rtc_1' };
    });
    t.provider.openSideband.mockImplementation(async () => {
      order.push('openSideband');
      return t.sideband;
    });
    await connectBrowserVoiceSession(t.deps, t.input);
    order.push('answer returned');

    expect(order).toEqual(['createCall', 'openSideband', 'answer returned']);
  });

  it('sends the server-defined tools and instructions, never the browser’s', async () => {
    const t = createSetup();
    const answer = await connectBrowserVoiceSession(t.deps, t.input);

    const request = (t.provider.createCall.mock.calls[0] as unknown[])[0] as {
      sdp: string;
      model: string;
      session: {
        instructions: string;
        outputModalities: string[];
        turnDetection?: { create_response: false };
      };
    };
    expect(request.sdp).toBe('offer');
    expect(request.model).toBe('test-model');
    expect(request.session.instructions).toContain(
      'Do not start with a greeting on your own',
    );
    expect(answer.greeting).toBe(
      'Thank you for calling TutWithUs. How may I help you today?',
    );
    expect(request.session.outputModalities).toEqual(['audio']);
    expect(request.session.turnDetection).toMatchObject({
      create_response: false,
    });
  });

  it('keeps Arabic replies on OpenAI audio output', async () => {
    const t = createSetup({ locale: 'ar-SA' });
    await connectBrowserVoiceSession(t.deps, t.input);

    const request = (t.provider.createCall.mock.calls[0] as unknown[])[0] as {
      session: { outputModalities: string[] };
    };
    expect(request.session.outputModalities).toEqual(['audio']);
  });

  it('starts a browser call as verified when credentials were checked before connection', async () => {
    const t = createSetup();
    await t.activeCalls.notifyAccountCheck(
      t.input.sessionId,
      'verified',
      'server-token',
      'student',
    );
    await connectBrowserVoiceSession(t.deps, t.input);

    const request = (t.provider.createCall.mock.calls[0] as unknown[])[0] as {
      session: { instructions: string };
    };
    expect(request.session.instructions).toContain(
      'already verified their phone number and TutWithUs member ID',
    );
    expect(request.session.instructions).toContain(
      'Never ask for their phone number or member ID again',
    );
    expect(request.session.instructions).toContain(
      'In-call request_member_id and verify_member_id tools are intentionally omitted and are not needed',
    );
    expect(request.session.instructions).toContain(
      'Use listed protected action tools directly',
    );
  });

  it('includes wallet tools when the browser credentials were verified before connection', async () => {
    const tools = new ToolGateway(
      [
        createGetMyWalletTool(async () => ({
          status: 'unavailable',
        })),
      ],
      { record: async () => undefined },
      logger,
    );
    const t = createSetup({ tools });
    await t.activeCalls.notifyAccountCheck(
      t.input.sessionId,
      'verified',
      'server-token',
      'student',
    );

    await connectBrowserVoiceSession(t.deps, t.input);

    const request = (t.provider.createCall.mock.calls[0] as unknown[])[0] as {
      session: { tools: Array<{ name: string }> };
    };
    expect(request.session.tools.map(({ name }) => name)).toContain(
      'get_my_wallet',
    );
  });

  it('does not expose in-call verification tools to an unverified browser call', async () => {
    const t = createSetup();
    await connectBrowserVoiceSession(t.deps, t.input);

    const request = (t.provider.createCall.mock.calls[0] as unknown[])[0] as {
      session: { instructions: string };
    };
    expect(request.session.instructions).toContain(
      'This is a public-only call',
    );
  });

  it('keeps a browser call public-only when no credentials were supplied', async () => {
    const t = createSetup();
    await connectBrowserVoiceSession(t.deps, t.input);

    const request = (t.provider.createCall.mock.calls[0] as unknown[])[0] as {
      session: { instructions: string };
    };
    expect(request.session.instructions).toContain('Use only public tools');
    expect(request.session.instructions).toContain(
      'Never request a phone number or member ID',
    );
    expect(request.session.instructions).toContain(
      'do not announce this status during the greeting',
    );
  });

  it('returns the active localized greeting for the browser to speak verbatim', async () => {
    const t = createSetup({ locale: 'fr' });
    const greeting = 'Bonjour, bienvenue chez TutWithUs.';
    vi.mocked(t.deps.settingsReader.getActiveAgentSettings).mockResolvedValue({
      greeting: {
        'ar-SA': 'أهلًا بك',
        en: 'Welcome',
        fr: greeting,
      },
      instructionTemplate: 'Be friendly.',
      voice: 'marin',
      maxCallSec: 300,
      businessHours: 'Weekdays',
      escalation: { hoursText: 'Contact us during business hours.' },
    });

    await expect(
      connectBrowserVoiceSession(t.deps, t.input),
    ).resolves.toMatchObject({
      greeting,
    });
  });

  it('records transcript turns and the outcome when the call ends', async () => {
    const t = createSetup();
    await connectBrowserVoiceSession(t.deps, t.input);
    const handlers = t.sidebandHandlers[0]!;

    handlers.onEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'u1',
      transcript: 'hello',
    } as RealtimeServerEvent);
    await vi.waitFor(() =>
      expect(t.repository.appendTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: expect.objectContaining({ eventId: 'user:u1', text: 'hello' }),
        }),
      ),
    );

    await t.activeCalls.stop(t.input.sessionId, 'user_ended');
    expect(t.provider.hangup).toHaveBeenCalledWith('rtc_1');
    expect(t.liveCalls.release).toHaveBeenCalledOnce();
    expect(t.repository.endCall).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'user_ended' }),
    );
    expect(t.repository.recordCallOutcome).toHaveBeenCalled();
    expect(t.activeCalls.size).toBe(0);
  });

  it('replays events that arrive before the controller exists', async () => {
    const t = createSetup({
      openSideband: async (_callId, handlers) => {
        handlers.onEvent({
          type: 'conversation.item.input_audio_transcription.completed',
          item_id: 'early',
          transcript: 'first words',
        } as RealtimeServerEvent);
        return { send: vi.fn(), close: vi.fn() };
      },
    });
    await connectBrowserVoiceSession(t.deps, t.input);

    await vi.waitFor(() =>
      expect(t.repository.appendTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          entry: expect.objectContaining({ eventId: 'user:early' }),
        }),
      ),
    );
  });

  it('ends the call when the control connection drops', async () => {
    const t = createSetup();
    await connectBrowserVoiceSession(t.deps, t.input);
    t.sidebandHandlers[0]!.onClosed();

    await vi.waitFor(() =>
      expect(t.repository.endCall).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'connection_closed' }),
      ),
    );
    expect(t.provider.hangup).toHaveBeenCalledWith('rtc_1');
  });

  it('hangs up the unsupervised call and frees the slot when the control connection cannot open', async () => {
    const t = createSetup({
      openSideband: async () => {
        throw new RealtimeProviderError('control connection failed');
      },
    });

    await expect(
      connectBrowserVoiceSession(t.deps, t.input),
    ).rejects.toMatchObject({ code: 'REALTIME_UNAVAILABLE' });
    expect(t.provider.hangup).toHaveBeenCalledWith('rtc_1');
    expect(t.liveCalls.release).toHaveBeenCalledOnce();
    expect(t.repository.endCall).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'control_failed' }),
    );
    expect(t.activeCalls.size).toBe(0);
  });

  it('refuses new calls at capacity without starting the session or contacting OpenAI', async () => {
    const t = createSetup({ acquire: false });

    await expect(
      connectBrowserVoiceSession(t.deps, t.input),
    ).rejects.toMatchObject({ code: 'CALL_CAPACITY_REACHED' });
    expect(t.repository.startCall).not.toHaveBeenCalled();
    expect(t.provider.createCall).not.toHaveBeenCalled();
  });

  it('frees the slot when the session was already used', async () => {
    const t = createSetup({ startCall: false });

    await expect(
      connectBrowserVoiceSession(t.deps, t.input),
    ).rejects.toMatchObject({ code: 'SESSION_ALREADY_USED' });
    expect(t.liveCalls.release).toHaveBeenCalledOnce();
    expect(t.provider.createCall).not.toHaveBeenCalled();
  });

  it('frees the slot and ends the session when OpenAI refuses the call', async () => {
    const t = createSetup();
    t.provider.createCall.mockRejectedValue(
      new RealtimeProviderError('provider unavailable'),
    );

    await expect(
      connectBrowserVoiceSession(t.deps, t.input),
    ).rejects.toMatchObject({ code: 'REALTIME_UNAVAILABLE' });
    expect(t.liveCalls.release).toHaveBeenCalledOnce();
    expect(t.repository.endCall).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'connection_failed' }),
    );
    expect(t.provider.openSideband).not.toHaveBeenCalled();
  });

  it('rejects a wrong session token before reserving anything', async () => {
    const t = createSetup();

    await expect(
      connectBrowserVoiceSession(t.deps, {
        ...t.input,
        sessionToken: createOpaqueToken().token,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_UNAUTHORIZED' });
    expect(t.liveCalls.acquire).not.toHaveBeenCalled();
    expect(t.provider.createCall).not.toHaveBeenCalled();
  });

  it('does not contact OpenAI without an API key', async () => {
    const t = createSetup();
    t.deps.config.openai.apiKey = undefined;

    await expect(
      connectBrowserVoiceSession(t.deps, t.input),
    ).rejects.toMatchObject({ code: 'OPENAI_NOT_CONFIGURED' });
    expect(t.liveCalls.acquire).not.toHaveBeenCalled();
  });
});
