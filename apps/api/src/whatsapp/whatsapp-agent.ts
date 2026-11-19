import { cli, defineAgent, ServerOptions, voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as openai from '@livekit/agents-plugin-openai';
import { ParticipantKind } from '@livekit/rtc-node';
import { createLogger, errorName } from '../lib/logger.js';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { buildAgentProfile } from '../core/agent/agent-profile.js';
import { SPEECH_TEXT_REPLACEMENTS } from '../core/speech/brand-pronunciation.js';
import { KnowledgeRetriever } from '../core/retrieval/knowledge-retriever.js';
import { createVoiceTools } from '../core/tools/handlers/voice-tools.js';
import { ToolGateway, type ToolCall } from '../core/tools/tool-gateway.js';
import { OpenAIEmbeddingsClient } from '../lib/openai/embeddings-client.js';
import { MongoEscalationRepository } from '../modules/escalations/escalation.repository.js';
import { EscalationService } from '../modules/escalations/escalation.service.js';
import { MongoKnowledgeRepository } from '../modules/knowledge/knowledge.repository.js';
import { MongoAgentSettingsRepository } from '../modules/settings/agent-settings.repository.js';
import { AgentSettingsService } from '../modules/settings/agent-settings.service.js';
import { MongoToolInvocationRepository } from '../modules/tool-invocations/tool-invocation.repository.js';
import { MongoVoiceSessionRepository } from '../modules/voice-sessions/voice-session.repository.js';
import { WhatsAppSessionService } from '../modules/voice-sessions/whatsapp-session.service.js';
import { TutWithUsService } from '../external/tutwithus/tutwithus-service.js';
import { getTrustedWhatsAppCallerNumber } from '../transports/whatsapp/livekit-sip-caller.js';
import { getMetaWhatsAppCallId } from '../transports/whatsapp/meta-whatsapp-call-id.js';
import { CallLifecycle, type CallEndReason } from './call-lifecycle.js';
import { buildLiveKitTools } from './call-tools.js';
import { reserveMemberVerification } from '../modules/voice-sessions/verification-limit.js';
import { describeWhatsAppAccountPolicy } from './caller-account.js';
import { loadConfig } from './config.js';
import {
  createTranscriptReplyGate,
  TranscriptGatedAgent,
} from './transcript-gate.js';
import {
  accountMessages,
  createVerifyMemberIdTool,
  lookupWhatsAppRegistration,
  registrationMessages,
} from './account-flow.js';

const config = loadConfig();
const logger = createLogger({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  service: 'whatsapp-worker',
});

// Same fallbacks as the browser path when no settings version is active yet.
const DEFAULT_RETRIEVAL = { topK: 5, minScore: 0.7 };
const DEFAULT_RESPONSE_EXPECTATION =
  'The TutWithUs team will review your request.';
// Time for the goodbye to play after end_call, before the line is dropped.
const GOODBYE_GRACE_MS = 6_000;

export default defineAgent({
  entry: async (ctx) => {
    await ctx.connect();
    const caller = await ctx.waitForParticipant();
    if (
      caller.kind !== ParticipantKind.SIP ||
      caller.attributes['sip.trunkID'] !== config.whatsappSipTrunkId
    ) {
      throw new Error(
        'WhatsApp agent received a participant outside the configured SIP trunk.',
      );
    }

    const callerNumber = getTrustedWhatsAppCallerNumber(
      {
        kind: caller.kind,
        attributes: caller.attributes,
      },
      ParticipantKind.SIP,
      config.whatsappSipTrunkId,
    );
    let metaCallId: string | undefined;
    try {
      const response = await ctx.room.localParticipant!.performRpc({
        destinationIdentity: caller.identity,
        method: 'lk.sip.GetRemoteHeaders',
        payload: JSON.stringify({
          include: ['x-wa-meta-wacid'],
        }),
      });
      metaCallId = getMetaWhatsAppCallId(response);
      if (!metaCallId) {
        logger.warn(
          { source: 'whatsapp' },
          'Meta call ID is missing from the SIP INVITE; webhook events cannot be correlated to this AI session',
        );
      }
    } catch (error) {
      logger.warn(
        {
          source: 'whatsapp',
          errorName: errorName(error),
        },
        'Meta call ID could not be read from the SIP INVITE',
      );
    }

    if (!callerNumber) {
      logger.warn(
        { source: 'whatsapp' },
        'Caller identity is unavailable or untrusted; account actions stay disabled',
      );
    }

    if (!config.mongoUri || !config.openaiApiKey || !config.callerHashSecret) {
      throw new Error('WhatsApp agent dependencies are not configured.');
    }
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri);
    }

    const settings = await new AgentSettingsService(
      new MongoAgentSettingsRepository(),
    ).getActiveAgentSettings();
    const profile = buildAgentProfile(config.whatsappDefaultLocale, settings);
    const maxCallSec = settings?.maxCallSec ?? config.maxCallSec;

    const directory = new TutWithUsService(config.tutWithUs, logger);
    const loginMember = directory.loginMember.bind(directory);
    directory.loginMember = async (query) =>
      (await reserveMemberVerification(query.phone))
        ? loginMember(query)
        : { status: 'unavailable' };
    const messages = accountMessages[profile.locale];
    const registrationStatus = await lookupWhatsAppRegistration(
      directory,
      callerNumber,
    );
    const canVerifyCaller = registrationStatus === 'registered';

    // One stored record per call, so admins can see it and tool calls attach to it.
    const sessions = new WhatsAppSessionService(
      new MongoVoiceSessionRepository(),
      {
        callerHashSecret: config.callerHashSecret,
        retentionDays: config.retentionDays,
      },
    );
    const handle = await sessions.begin({
      locale: profile.locale,
      callerNumber,
      metaCallId,
      maxCallSec,
    });
    // The same tools, limits and customer rules as the browser call.
    const embeddings = new OpenAIEmbeddingsClient(
      config.openaiApiKey,
      config.openaiEmbeddingModel,
    );
    const gateway = new ToolGateway(
      [
        ...createVoiceTools({
          retriever: new KnowledgeRetriever(
            embeddings,
            new MongoKnowledgeRepository(),
          ),
          escalations: new EscalationService(
            new MongoEscalationRepository(),
            async (sessionId) => {
              if (sessionId !== handle.sessionId)
                throw new Error('Invalid call');
              return {
                verified: false,
                ...(handle.contactPhone
                  ? { contactPhone: handle.contactPhone }
                  : {}),
              };
            },
          ),
          accountActions: true,
          getMyBootcamps: (accessToken) =>
            directory.getMyBootcamps(accessToken),
          getMyWallet: (accessToken) => directory.getMyWallet(accessToken),
          getMyTutorAvailability: (accessToken) =>
            directory.getMyTutorAvailability(accessToken),
          getSubjects: () => directory.getSubjects(),
          searchTutorProfiles: (query) => directory.searchTutorProfiles(query),
          checkSubjectEligibility: (accessToken, subjectId) =>
            directory.checkSubjectEligibility(accessToken, subjectId),
          recommendCourseBundles: (subjectName) =>
            directory.recommendCourseBundles(subjectName),
          getBookingLevels: () => directory.getBookingLevels(),
          getBookingSubjects: (accessToken, levelId) =>
            directory.getBookingSubjects(accessToken, levelId),
          findBookingTutors: (accessToken, input) =>
            directory.findBookingTutors(accessToken, input),
          getTutorBookingAvailability: (accessToken, input) =>
            directory.getTutorBookingAvailability(accessToken, input),
          createCourse: (accessToken, input) =>
            directory.createCourse(accessToken, input),
          getUpcomingCourses: (accessToken) =>
            directory.getUpcomingCourses(accessToken),
          getCourses: (accessToken, filter) =>
            directory.getCourses(accessToken, filter),
          cancelCourse: (accessToken, courseId) =>
            directory.cancelCourse(accessToken, courseId),
        }),
        ...(canVerifyCaller
          ? [
              createVerifyMemberIdTool({
                directory,
                phone: callerNumber?.replace(/^\+/, ''),
                locale: profile.locale,
                registrationStatus,
              }),
            ]
          : []),
      ],
      new MongoToolInvocationRepository(),
      logger,
    );
    const toolCall: ToolCall = {
      context: {
        sessionId: handle.sessionId,
        locale: profile.locale,
        accountAccessHint: canVerifyCaller
          ? messages.askId
          : registrationStatus === 'not_registered'
            ? registrationMessages[profile.locale]
            : messages.unavailable,
        verificationAvailable: canVerifyCaller,
        actionUnavailableMessage: messages.unavailable,
        retrieval: settings?.retrieval ?? DEFAULT_RETRIEVAL,
        responseExpectation:
          settings?.escalation.hoursText ?? DEFAULT_RESPONSE_EXPECTATION,
      },
      callCounts: new Map(),
      recordExpiresAt: handle.expiresAt,
      customerVerified: false,
    };

    // Assigned once the session exists; end_call can only run after that.
    const link: {
      lifecycle?: CallLifecycle;
      refreshAgentTools?: () => Promise<void>;
    } = {};
    const makeTools = () =>
      buildLiveKitTools({
        gateway,
        call: toolCall,
        onEndCall: () => link.lifecycle?.requestEnd('end_call'),
        onToolAccessChanged: () => link.refreshAgentTools?.(),
      });
    const tools = makeTools();

    const usesSaudiArabicVoice = profile.locale === 'ar-SA';
    const agent = new TranscriptGatedAgent({
      instructions: `${profile.instructions}\n\n${describeWhatsAppAccountPolicy(profile.locale, canVerifyCaller, registrationStatus)}`,
      llm: usesSaudiArabicVoice
        ? new openai.LLM({
            model: config.openaiConversationModel,
            apiKey: config.openaiApiKey,
          })
        : new openai.realtime.RealtimeModel({
            model: config.openaiRealtimeModel,
            apiKey: config.openaiApiKey,
            voice: profile.voice,
            turnDetection: {
              type: 'server_vad',
              threshold: 0.8,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: false,
            },
          }),
      ...(usesSaudiArabicVoice
        ? {
            stt: new openai.STT({
              model: config.openaiTranscriptionModel,
              apiKey: config.openaiApiKey,
              language: 'ar',
              detectLanguage: false,
              useRealtime: true,
            }),
            tts: new elevenlabs.TTS({
              apiKey: config.elevenLabs.apiKey,
              voiceId: config.elevenLabs.saudiArabicVoiceId,
              model: config.elevenLabs.modelId,
              languageCode: 'ar',
            }),
          }
        : {}),
      tools,
    });
    link.refreshAgentTools = () => agent.updateTools(makeTools());

    const transcriptReplyGate = createTranscriptReplyGate();
    // "Away" means neither side has spoken for this long (seconds).
    const session = new voice.AgentSession({
      userAwayTimeout: config.idleTimeoutSec,
      turnDetection: usesSaudiArabicVoice ? 'stt' : 'realtime_llm',
      ...(usesSaudiArabicVoice
        ? {
            ttsTextTransforms: [
              'filter_markdown' as const,
              'filter_emoji' as const,
              voice.textTransforms.replace(SPEECH_TEXT_REPLACEMENTS),
            ],
          }
        : {}),
    });
    const lifecycle = new CallLifecycle({
      session,
      maxCallSec,
      goodbyeGraceMs: GOODBYE_GRACE_MS,
      onEnded: async (reason: CallEndReason) => {
        try {
          await sessions.end(handle, { reason });
        } catch {
          logger.error(
            { source: 'whatsapp', sessionId: handle.sessionId },
            'WhatsApp session record could not be closed',
          );
        }
        if (reason !== 'caller_left') {
          // Drop the line for the caller too.
          await ctx.deleteRoom().catch(() => undefined);
        }
        ctx.shutdown(reason);
      },
    });
    link.lifecycle = lifecycle;
    lifecycle.start();

    session.on(voice.AgentSessionEventTypes.Error, (event) => {
      if (!event.error.recoverable) lifecycle.fail();
    });
    const confirmationTranscriptGate = createTranscriptReplyGate();
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
      if (confirmationTranscriptGate(event))
        gateway.observeCallerTranscript(handle.sessionId, event.transcript);
    });
    if (!usesSaudiArabicVoice) {
      session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
        if (!transcriptReplyGate(event)) {
          return;
        }

        queueMicrotask(() => {
          if (!lifecycle.isEnded) {
            try {
              session.generateReply();
            } catch (error) {
              logger.error(
                {
                  source: 'whatsapp',
                  sessionId: handle.sessionId,
                  errorName: errorName(error),
                },
                'Could not schedule a reply to the caller',
              );
              lifecycle.fail();
            }
          }
        });
      });
    }
    try {
      await session.start({ agent, room: ctx.room, record: false });
      session.generateReply({
        instructions: `Say this exact greeting once, verbatim, and say nothing else: ${JSON.stringify(profile.greeting)}. End the response immediately after the greeting, then wait silently for the caller. Do not speak formatting labels or tags.`,
        allowInterruptions: false,
      });
    } catch {
      lifecycle.fail();
    }
  },
});

if (!config.whatsappCallingEnabled) {
  throw new Error(
    'WhatsApp calling is disabled; set WHATSAPP_CALLING_ENABLED=true after configuring LiveKit and Meta SIP.',
  );
}

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: config.livekit.whatsappAgentName,
    wsURL: config.livekit.url,
    apiKey: config.livekit.apiKey,
    apiSecret: config.livekit.apiSecret,
  }),
);
