import { errorName, type Logger } from '../../lib/logger.js';
import type { ApiConfig } from '../../config/env.js';
import { buildAgentProfile } from '../../core/agent/agent-profile.js';
import type { ActiveCallRegistry } from '../../core/session/active-calls.js';
import { buildRealtimeSessionConfiguration } from '../../core/session/realtime-session-config.js';
import { SessionController } from '../../core/session/session-controller.js';
import type {
  RealtimeServerEvent,
  SidebandCloseInfo,
} from '../../core/session/session-ports.js';
import type { ToolGateway } from '../../core/tools/tool-gateway.js';
import type { LiveCallLimiter } from '../../lib/live-calls.js';
import {
  RealtimeProviderError,
  type RealtimeProvider,
} from '../../lib/openai/realtime-client.js';
import type { AgentProfileSettingsReader } from '../../modules/settings/agent-settings.service.js';
import {
  getAuthorizedVoiceSession,
  SESSION_START_WINDOW_MS,
  VoiceSessionError,
} from '../../modules/voice-sessions/voice-session.service.js';
import type { VoiceSessionRepository } from '../../modules/voice-sessions/voice-session.repository.js';

// Used when no settings version is active yet.
const DEFAULT_RETRIEVAL = { topK: 5, minScore: 0.7 };
const DEFAULT_RESPONSE_EXPECTATION =
  'The TutWithUs team will review your request.';
// How long a capacity slot is held beyond the call limit if the API dies mid-call.
const CAPACITY_SLOT_GRACE_SEC = 60;
// Allow a little extra time for the OpenAI Realtime goodbye audio to finish.
const GOODBYE_GRACE_AUDIO_MS = 3_000;

function browserAccountPolicy(
  locale: 'en' | 'fr' | 'ar-SA',
  customerVerified: boolean,
): string {
  if (customerVerified) {
    return 'BROWSER ACCOUNT STATUS: The customer already verified their phone number and TutWithUs member ID before this call connected. In-call request_member_id and verify_member_id tools are intentionally omitted and are not needed. Use listed protected action tools directly. Never say verification is unavailable. Never ask for their phone number or member ID again.';
  }
  const message = {
    en: 'Sorry, this action is unavailable now. Please try again later. For now, I am ready to answer any question you have about TutWithUs.',
    fr: 'Désolé, cette action est indisponible pour le moment. Veuillez réessayer plus tard. Pour le moment, je peux répondre à vos questions générales sur TutWithUs.',
    'ar-SA':
      'عذرًا، هذا الإجراء غير متاح الآن. حاول مرة أخرى لاحقًا. حاليًا أنا جاهز للإجابة عن أي سؤال عام لديك عن TutWithUs.',
  }[locale];
  return `BROWSER ACCOUNT STATUS: This is a public-only call because no credentials were entered before it started. Never request a phone number or member ID and never offer account verification during this call. Use only public tools. Only when the caller requests an account-specific action, say exactly once: “${message}” Continue answering public TutWithUs questions normally and do not announce this status during the greeting.`;
}

export type BrowserVoiceDeps = {
  config: Pick<ApiConfig, 'maxCallSec' | 'idleTimeoutSec' | 'openai'>;
  repository: VoiceSessionRepository;
  settingsReader: AgentProfileSettingsReader;
  provider: RealtimeProvider;
  tools: ToolGateway;
  liveCalls: LiveCallLimiter;
  activeCalls: ActiveCallRegistry;
  logger: Logger;
};

export async function connectBrowserVoiceSession(
  deps: BrowserVoiceDeps,
  input: {
    sessionId: string;
    sessionToken: string;
    sdp: string;
    signal?: AbortSignal | undefined;
    now?: Date;
  },
): Promise<{ sdp: string; greeting: string }> {
  const { config, repository, provider, tools, liveCalls, logger } = deps;
  const { sessionId, signal } = input;
  const now = input.now ?? new Date();

  const record = await getAuthorizedVoiceSession(
    sessionId,
    input.sessionToken,
    repository,
    now,
  );
  if (!record.consentAccepted) {
    throw new VoiceSessionError(
      'SESSION_UNAUTHORIZED',
      'Consent is required to start a voice session.',
    );
  }
  if (record.startedAt || record.endedAt) {
    throw new VoiceSessionError(
      'SESSION_ALREADY_USED',
      'This voice session has already been used.',
    );
  }
  if (now.getTime() - record.acceptedAt.getTime() >= SESSION_START_WINDOW_MS) {
    throw new VoiceSessionError(
      'SESSION_UNAUTHORIZED',
      'The voice session is invalid or expired.',
    );
  }
  if (!config.openai.apiKey) {
    throw new VoiceSessionError(
      'OPENAI_NOT_CONFIGURED',
      'Voice service is not configured.',
    );
  }

  let activeSettings: Awaited<
    ReturnType<AgentProfileSettingsReader['getActiveAgentSettings']>
  >;
  try {
    activeSettings = await deps.settingsReader.getActiveAgentSettings();
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'Active agent settings could not be loaded.',
      { cause: error },
    );
  }

  const pendingAccount = deps.activeCalls.consumePendingAccountCheck(sessionId);
  const initialAccount =
    pendingAccount?.outcome === 'verified' &&
    pendingAccount.serverAccessToken &&
    pendingAccount.serverRole
      ? {
          serverAccessToken: pendingAccount.serverAccessToken,
          serverRole: pendingAccount.serverRole,
        }
      : undefined;
  const customerVerified = Boolean(initialAccount);
  // Browser identity is decided before connection. In-call member-ID tools are
  // intentionally unavailable; WhatsApp keeps its existing verification flow.
  const verificationAvailable = false;
  const baseProfile = buildAgentProfile(record.locale, activeSettings);
  const profile = {
    ...baseProfile,
    instructions: `${baseProfile.instructions}\n\n${browserAccountPolicy(record.locale, customerVerified)}`,
  };
  const maxCallSec =
    record.maxDurationSec ?? activeSettings?.maxCallSec ?? config.maxCallSec;
  const sessionTokenHash = record.sessionTokenHash;

  if (
    !(await liveCalls.acquire(sessionId, maxCallSec + CAPACITY_SLOT_GRACE_SEC))
  ) {
    throw new VoiceSessionError(
      'CALL_CAPACITY_REACHED',
      'All voice lines are busy. Please try again shortly.',
    );
  }

  // Ends the session record and frees the capacity slot after a failed start.
  const abandon = async (reason: string): Promise<void> => {
    await liveCalls.release(sessionId);
    await repository.endCall({
      sessionId,
      sessionTokenHash,
      endedAt: new Date(),
      reason,
    });
  };

  try {
    const claimed = await repository.startCall({
      sessionId,
      sessionTokenHash,
      startedAt: now,
      callExpiresAt: new Date(now.getTime() + maxCallSec * 1000),
    });
    if (!claimed) {
      await liveCalls.release(sessionId);
      throw new VoiceSessionError(
        'SESSION_ALREADY_USED',
        'This voice session has already been used.',
      );
    }
  } catch (error) {
    if (error instanceof VoiceSessionError) {
      throw error;
    }
    await liveCalls.release(sessionId);
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'Voice session could not be started.',
      { cause: error },
    );
  }

  const realtimeTools = tools.realtimeTools({
    customerVerified,
    ...(initialAccount ? { serverRole: initialAccount.serverRole } : {}),
    verificationAvailable,
  });
  logger.info(
    {
      source: 'browser-voice-transport',
      sessionId,
      customerVerified,
      serverRole: initialAccount?.serverRole,
      availableToolNames: realtimeTools.map((tool) => tool.name).sort(),
    },
    'Browser realtime tools configured',
  );
  const session = buildRealtimeSessionConfiguration(profile, realtimeTools);
  if (config.openai.turnDetection) {
    session.turnDetection = config.openai.turnDetection;
  }

  let answer: Awaited<ReturnType<RealtimeProvider['createCall']>>;
  try {
    answer = await provider.createCall(
      { sdp: input.sdp, model: config.openai.realtimeModel, session },
      signal,
    );
  } catch (error) {
    try {
      await abandon('connection_failed');
    } catch (persistenceError) {
      throw new VoiceSessionError(
        'PERSISTENCE_FAILED',
        'Voice session cleanup failed.',
        { cause: persistenceError },
      );
    }

    if (error instanceof RealtimeProviderError) {
      throw new VoiceSessionError(
        'REALTIME_UNAVAILABLE',
        'The voice service could not be reached. Please try again.',
        { cause: error },
      );
    }
    throw error;
  }

  // The call exists now. Attach the server-side control connection before the
  // browser gets the answer, so no tool call can happen unsupervised.
  const callId = answer.callId;
  try {
    await repository.attachProviderCall({
      sessionId,
      sessionTokenHash,
      providerCallId: callId,
    });

    const early: RealtimeServerEvent[] = [];
    // Events can arrive before the controller exists; they are replayed below.
    const link: { controller?: SessionController } = {};
    let sidebandClosed = false;
    let sidebandCloseInfo: SidebandCloseInfo | undefined;
    const sideband = await provider.openSideband(callId, {
      onEvent: (event) => {
        if (link.controller) {
          void link.controller.handleEvent(event);
        } else {
          early.push(event);
        }
      },
      onClosed: (details) => {
        sidebandClosed = true;
        sidebandCloseInfo = details;
        void link.controller?.handleSidebandClosed(details);
      },
    });

    const controller = new SessionController({
      sessionId,
      sideband,
      tools,
      toolContext: {
        sessionId,
        verificationAvailable,
        locale: record.locale,
        timeZone: record.timeZone ?? 'UTC',
        retrieval: activeSettings?.retrieval ?? DEFAULT_RETRIEVAL,
        responseExpectation:
          activeSettings?.escalation.hoursText ?? DEFAULT_RESPONSE_EXPECTATION,
      },
      startedAt: now,
      ...(initialAccount ? { initialAccount } : {}),
      recordExpiresAt: record.expiresAt,
      expected: {
        instructions: session.instructions,
        toolNames: tools.toolNames({
          customerVerified,
          ...(initialAccount ? { serverRole: initialAccount.serverRole } : {}),
          verificationAvailable,
        }),
        outputModalities: session.outputModalities,
      },
      limits: { maxCallSec, idleTimeoutSec: config.idleTimeoutSec },
      goodbyePlaybackGraceMs: GOODBYE_GRACE_AUDIO_MS,
      logger,
      hooks: {
        recordTranscript: async (turn) => {
          await repository.appendTranscript({
            sessionId,
            sessionTokenHash,
            entry: turn,
            receivedAt: new Date(),
          });
        },
        hangup: () => provider.hangup(callId),
        onEnded: async (end) => {
          deps.activeCalls.remove(sessionId);
          await liveCalls.release(sessionId);
          try {
            await repository.endCall({
              sessionId,
              sessionTokenHash,
              endedAt: new Date(),
              reason: end.reason,
            });
          } finally {
            await repository.recordCallOutcome({
              sessionId,
              sessionTokenHash,
              outcome: { flags: end.flags, usage: end.usage },
            });
          }
        },
      },
    });
    link.controller = controller;
    for (const event of early) {
      await controller.handleEvent(event);
    }
    if (sidebandClosed) {
      await controller.handleSidebandClosed(sidebandCloseInfo);
    }
    if (!controller.isStopped) {
      controller.start({ autoRespondToNotices: false });
      deps.activeCalls.add(controller);
    }
  } catch (error) {
    logger.error(
      {
        source: 'browser-voice',
        sessionId,
        errorName: errorName(error),
      },
      'Voice control connection could not be established',
    );
    // A call nobody supervises must not keep running.
    await provider.hangup(callId).catch(() => undefined);
    try {
      await abandon('control_failed');
    } catch (persistenceError) {
      throw new VoiceSessionError(
        'PERSISTENCE_FAILED',
        'Voice session cleanup failed.',
        { cause: persistenceError },
      );
    }
    throw new VoiceSessionError(
      'REALTIME_UNAVAILABLE',
      'The voice service could not be reached. Please try again.',
      { cause: error },
    );
  }

  return { sdp: answer.sdp, greeting: profile.greeting };
}
