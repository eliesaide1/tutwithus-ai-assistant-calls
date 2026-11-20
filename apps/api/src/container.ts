import { createLogger } from './lib/logger.js';
import type { ApiConfig } from './config/env.js';
import { mongoReadinessCheck } from './db/health.js';
import type { AppDependencies } from './http/app-dependencies.js';
import { OpenAIEmbeddingsClient } from './lib/openai/embeddings-client.js';
import { OpenAIRealtimeClient } from './lib/openai/realtime-client.js';
import { KnowledgeRetriever } from './core/retrieval/knowledge-retriever.js';
import { ActiveCallRegistry } from './core/session/active-calls.js';
import { createVoiceTools } from './core/tools/handlers/voice-tools.js';
import { ToolGateway } from './core/tools/tool-gateway.js';
import {
  InMemoryLiveCallLimiter,
  RedisLiveCallLimiter,
} from './lib/live-calls.js';
import { closeRedis, createRedisClient } from './lib/redis.js';
import { createMaintenanceJobs } from './jobs/maintenance-jobs.js';
import { MongoAdminUserRepository } from './modules/admin-users/admin-user.repository.js';
import { MongoAuditRepository } from './modules/audit/audit.repository.js';
import { MongoBookingRepository } from './modules/bookings/booking.repository.js';
import { MongoEscalationRepository } from './modules/escalations/escalation.repository.js';
import { EscalationService } from './modules/escalations/escalation.service.js';
import { MongoAgentSettingsRepository } from './modules/settings/agent-settings.repository.js';
import { KnowledgeIngestionService } from './modules/knowledge/knowledge-ingestion.service.js';
import { MongoKnowledgeRepository } from './modules/knowledge/knowledge.repository.js';
import { MongoToolInvocationRepository } from './modules/tool-invocations/tool-invocation.repository.js';
import { MongoVoiceSessionRepository } from './modules/voice-sessions/voice-session.repository.js';
import { verifyVoiceSessionMemberId } from './modules/voice-sessions/account-check.service.js';
import { createVoiceEscalationContactResolver } from './modules/voice-sessions/voice-session.service.js';
import { NoopPlatformAdapter } from './platform/noop-platform-adapter.js';
import { TutWithUsService } from './external/tutwithus/tutwithus-service.js';
import { reserveMemberVerification } from './modules/voice-sessions/verification-limit.js';

export type Container = {
  deps: AppDependencies;
  // Closes every client the container opened (MongoDB is closed by server.ts).
  close: () => Promise<void>;
};

// Builds every shared client and repository in one place.
// Tests build their own AppDependencies with fakes instead of calling this.
export function createContainer(config: ApiConfig): Container {
  const logger = createLogger({
    level: config.logLevel,
    service: 'api',
  });
  const redis = createRedisClient(config.redisUrl, logger);
  const maintenanceJobs = createMaintenanceJobs(
    config.redisUrl,
    config.workerConcurrency,
    logger,
  );
  const knowledgeRepository = new MongoKnowledgeRepository();
  const escalationRepository = new MongoEscalationRepository();
  const voiceSessionRepository = new MongoVoiceSessionRepository();
  const bookingRepository = new MongoBookingRepository();
  // Without an OpenAI key, uploads are stored but not embedded.
  const embeddings = config.openai.apiKey
    ? new OpenAIEmbeddingsClient(
        config.openai.apiKey,
        config.openai.embeddingModel,
      )
    : undefined;
  const platformAdapter = new NoopPlatformAdapter();
  // Account actions need a customer source. Without one the agent is not
  // offered those tools and hands the caller to a human instead.
  const customerDirectory = new TutWithUsService(
    config.tutWithUs ?? {
      baseUrl: 'https://api.tutwithus.com',
      timeoutMs: 5000,
      authLoginPath: '/auth/login',
    },
    logger,
  );
  const loginMember = customerDirectory.loginMember.bind(customerDirectory);
  customerDirectory.loginMember = async (query) =>
    (await reserveMemberVerification(query.phone))
      ? loginMember(query)
      : { status: 'unavailable' };
  const toolGateway = new ToolGateway(
    createVoiceTools({
      retriever: embeddings
        ? new KnowledgeRetriever(embeddings, knowledgeRepository, logger)
        : undefined,
      escalations: new EscalationService(
        escalationRepository,
        createVoiceEscalationContactResolver(voiceSessionRepository),
      ),
      accountActions: true,
      verifyMemberId: async (sessionId, memberId) =>
        verifyVoiceSessionMemberId(
          { repository: voiceSessionRepository, directory: customerDirectory },
          { sessionId, memberId },
        ),
      getMyBootcamps: (accessToken) =>
        customerDirectory.getMyBootcamps(accessToken),
      getMyWallet: (accessToken) => customerDirectory.getMyWallet(accessToken),
      getMyTutorAvailability: (accessToken, timeZone) =>
        customerDirectory.getMyTutorAvailability(accessToken, timeZone),
      getSubjects: () => customerDirectory.getSubjects(),
      searchTutorProfiles: (query) =>
        customerDirectory.searchTutorProfiles(query),
      checkSubjectEligibility: (accessToken, subjectId) =>
        customerDirectory.checkSubjectEligibility(accessToken, subjectId),
      recommendCourseBundles: (subjectName) =>
        customerDirectory.recommendCourseBundles(subjectName),
      getBookingLevels: () => customerDirectory.getBookingLevels(),
      getBookingSubjects: (accessToken, levelId) =>
        customerDirectory.getBookingSubjects(accessToken, levelId),
      findBookingTutors: (accessToken, input) =>
        customerDirectory.findBookingTutors(accessToken, input),
      getTutorBookingAvailability: (accessToken, input) =>
        customerDirectory.getTutorBookingAvailability(accessToken, input),
      createCourse: (accessToken, input) =>
        customerDirectory.createCourse(accessToken, input),
      getUpcomingCourses: (accessToken) =>
        customerDirectory.getUpcomingCourses(accessToken),
      getCourses: (accessToken, filter) =>
        customerDirectory.getCourses(accessToken, filter),
      cancelCourse: (accessToken, courseId) =>
        customerDirectory.cancelCourse(accessToken, courseId),
    }),
    new MongoToolInvocationRepository(),
    logger,
  );
  const activeCalls = new ActiveCallRegistry();
  const settingsRepository = new MongoAgentSettingsRepository();
  return {
    deps: {
      config,
      logger,
      maintenanceJobs,
      readinessChecks: [mongoReadinessCheck],
      voiceSessionRepository,
      realtimeProvider: new OpenAIRealtimeClient(config.openai.apiKey),
      adminUserRepository: new MongoAdminUserRepository(),
      bookingRepository,
      escalationRepository,
      settingsRepository,
      auditRepository: new MongoAuditRepository(),
      knowledgeRepository,
      toolGateway,
      liveCalls: redis
        ? new RedisLiveCallLimiter(redis, config.maxConcurrentCalls, logger)
        : new InMemoryLiveCallLimiter(config.maxConcurrentCalls),
      activeCalls,
      platformAdapter,
      customerDirectory,
      knowledgeIngestion: new KnowledgeIngestionService(
        config,
        knowledgeRepository,
        embeddings,
      ),
    },
    close: async () => {
      // Hang up live calls before the clients they depend on go away.
      const failures: unknown[] = [];
      try {
        await activeCalls.stopAll('server_shutdown');
      } catch (error) {
        failures.push(error);
      }
      try {
        await maintenanceJobs.close();
      } catch (error) {
        failures.push(error);
      }
      if (redis) {
        try {
          await closeRedis(redis);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) {
        throw failures[0];
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          'One or more clients failed to close.',
        );
      }
    },
  };
}
