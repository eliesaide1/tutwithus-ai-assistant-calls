import { errorName, type Logger } from '../../lib/logger.js';
import { BookingConfirmation } from './booking-confirmation.js';
import { CancellationConfirmation } from './cancellation-confirmation.js';
import { ToolCallRejectedError } from './handlers/search-knowledge.js';
import {
  toRealtimeTools,
  type Citation,
  type RealtimeToolDefinition,
  type RegisteredTool,
  type ToolContext,
} from './tool-registry.js';

export type ToolInvocationEntry = {
  sessionId: string;
  tool: string;
  argsRedacted: unknown;
  decision: 'allowed' | 'denied';
  denyReason?: string;
  resultSummary?: string;
  latencyMs: number;
  expiresAt: Date;
};

export interface ToolInvocationRecorder {
  record(entry: ToolInvocationEntry): Promise<void>;
}

export type ToolExecution = {
  // JSON string sent back to the model as the function call output.
  output: string;
  citations: Citation[];
  endCall: boolean;
  followUpInstructions?: string;
  allowToolCalls?: boolean;
  sensitiveInputExpected?: boolean;
  customerVerified?: boolean;
  serverAccessToken?: string;
  serverRole?: string;
};

export type ToolCall = {
  context: ToolContext;
  // Per-call counters, owned by the session controller.
  callCounts: Map<string, number>;
  lastToolStatuses?: Map<string, string>;
  recordExpiresAt: Date;
  // True only after the server matched the caller to a registered customer.
  customerVerified: boolean;
  // Kept in memory for this call and passed only to server-side tools.
  serverAccessToken?: string;
  serverRole?: string;
};

function jsonOutput(value: unknown): string {
  return JSON.stringify(value);
}

function deniedFollowUp(
  tool: string,
  reason: string,
  locale: ToolContext['locale'],
  actionUnavailableMessage?: string,
  accountAccessHint?: string,
): string {
  if (reason === 'INVALID_ARGUMENTS' && tool === 'verify_member_id') {
    return {
      en: 'The member ID was not clear, so it was not sent for verification and did not use a verification attempt. Ask the caller once to say the complete member ID in one continuous phrase without pausing. Do not mention an expected length. Keep the original request pending. Do not repeat any characters or guess missing ones.',
      fr: 'L’identifiant membre n’était pas clair ; il n’a donc pas été envoyé pour vérification et aucune tentative n’a été utilisée. Demandez une seule fois à la personne de dire son identifiant complet en une seule fois, sans pause. Ne mentionnez aucune longueur attendue. Gardez la demande initiale en attente. Ne répétez aucun caractère et ne devinez pas ceux qui manquent.',
      'ar-SA':
        'رقم العضوية لم يكن واضحًا، لذلك لم يُرسل للتحقق ولم تُحتسب محاولة. اطلب من المتصل مرة واحدة قول رقم العضوية كاملًا دفعة واحدة ومن دون توقف. لا تذكر طولًا متوقعًا. احتفظ بالطلب الأصلي معلّقًا. لا تكرر أي حرف ولا تخمّن ما هو ناقص.',
    }[locale];
  }
  if (reason === 'ACCOUNT_NOT_VERIFIED' && accountAccessHint) {
    return accountAccessHint;
  }
  if (reason === 'TOOL_LIMIT' && tool === 'request_member_id') {
    return {
      en: 'The member-ID question was already asked. Do not ask again; stop speaking and wait for the caller.',
      fr: 'La question sur l’identifiant a déjà été posée. Ne la répétez pas ; arrêtez de parler et attendez la réponse.',
      'ar-SA':
        'تم طرح سؤال رقم العضوية بالفعل. لا تكرره؛ توقف وانتظر إجابة المتصل.',
    }[locale];
  }
  if (
    reason === 'ALREADY_VERIFIED' &&
    (tool === 'request_member_id' || tool === 'verify_member_id')
  ) {
    return {
      en: 'The caller is already verified for this call. Do not request or verify the member ID again; continue the pending request using the listed protected tools.',
      fr: 'La personne est déjà vérifiée pour cet appel. Ne redemandez pas et ne revérifiez pas son identifiant ; poursuivez la demande en attente avec les outils protégés présents.',
      'ar-SA':
        'تم التحقق من المتصل في هذه المكالمة. لا تطلب رقم العضوية أو تتحقق منه مرة أخرى؛ تابع الطلب المعلّق باستخدام الأدوات المحمية المدرجة.',
    }[locale];
  }
  if (
    reason === 'TOOL_LIMIT' &&
    tool !== 'verify_member_id' &&
    actionUnavailableMessage
  ) {
    return actionUnavailableMessage;
  }
  const instructions: Record<ToolContext['locale'], Record<string, string>> = {
    en: {
      ACCOUNT_NOT_VERIFIED:
        'This account action was not performed. If request_member_id and verify_member_id are available, ask for the member ID once and verify it before continuing. Otherwise, briefly explain that the action is unavailable. Never repeat the ID or ask for a phone number.',
      INVALID_ARGUMENTS:
        'The tool did not run because its arguments were invalid. Do not claim success or retry with guessed details. Ask one short clarifying question only if required information is actually missing.',
      LOCALE_MISMATCH:
        'The lookup did not run because its language did not match the caller’s language. Do not answer from memory; retry only with the caller’s language.',
      SESSION_NOT_LIVE:
        'The tool did not run because the call is no longer active. Do not claim the action was completed.',
      TOOL_LIMIT:
        'This tool cannot be used again during this call. Do not retry it or claim the action succeeded. Briefly explain that you cannot complete it now.',
      UNKNOWN_TOOL:
        'This capability is not available in the current call. Do not retry an unlisted tool or claim the action has started. Briefly explain that it is unavailable and offer team follow-up only with clear consent.',
      ROLE_NOT_AUTHORIZED:
        'This action is not available for the verified account. Do not retry it or claim it was performed. Briefly explain that the requested action is unavailable for this account.',
    },
    fr: {
      ACCOUNT_NOT_VERIFIED:
        'Cette action sur le compte n’a pas été effectuée. Si request_member_id et verify_member_id sont disponibles, demandez l’identifiant une seule fois et vérifiez-le avant de continuer. Sinon, expliquez brièvement que l’action n’est pas disponible. Ne répétez jamais l’identifiant et ne demandez pas de numéro de téléphone.',
      INVALID_ARGUMENTS:
        'L’outil n’a pas été exécuté, car ses arguments étaient invalides. N’affirmez pas que l’action a réussi et ne réessayez pas en devinant. Posez une seule question courte uniquement si une information nécessaire manque réellement.',
      LOCALE_MISMATCH:
        'La recherche n’a pas été exécutée, car sa langue ne correspondait pas à celle de la personne. Ne répondez pas de mémoire ; réessayez uniquement dans la langue de la personne.',
      SESSION_NOT_LIVE:
        'L’outil n’a pas été exécuté, car l’appel n’est plus actif. N’affirmez pas que l’action a été effectuée.',
      TOOL_LIMIT:
        'Cet outil ne peut plus être utilisé pendant cet appel. Ne réessayez pas et ne prétendez pas que l’action a réussi. Expliquez brièvement que vous ne pouvez pas la terminer maintenant.',
      UNKNOWN_TOOL:
        'Cette fonctionnalité n’est pas disponible pendant cet appel. Ne réessayez pas avec un outil absent et ne prétendez pas que l’action a commencé. Expliquez brièvement son indisponibilité et ne proposez un rappel de l’équipe qu’avec un accord clair.',
      ROLE_NOT_AUTHORIZED:
        'Cette action n’est pas disponible pour le compte vérifié. Ne réessayez pas et ne prétendez pas qu’elle a été effectuée. Expliquez brièvement que cette action n’est pas accessible pour ce compte.',
    },
    'ar-SA': {
      ACCOUNT_NOT_VERIFIED:
        'لم يُنفذ هذا الإجراء على الحساب. إذا كانت أداتا request_member_id وverify_member_id متاحتين، فاطلب رقم العضوية مرة واحدة وتحقق منه قبل المتابعة. وإلا فوضح باختصار أن الإجراء غير متاح. لا تكرر الرقم ولا تطلب رقم الهاتف.',
      INVALID_ARGUMENTS:
        'لم تعمل الأداة لأن المدخلات غير صحيحة. لا تدّعِ نجاح الإجراء ولا تعاود المحاولة بتخمين التفاصيل. اسأل سؤالًا توضيحيًا واحدًا وقصيرًا فقط إذا كانت هناك معلومة مطلوبة ناقصة فعلًا.',
      LOCALE_MISMATCH:
        'لم يعمل البحث لأن لغته لا تطابق لغة المتصل. لا تجب من الذاكرة؛ أعد المحاولة بلغة المتصل فقط.',
      SESSION_NOT_LIVE:
        'لم تعمل الأداة لأن المكالمة لم تعد نشطة. لا تدّعِ تنفيذ الإجراء.',
      TOOL_LIMIT:
        'لا يمكن استخدام هذه الأداة مرة أخرى في هذه المكالمة. لا تعاود المحاولة ولا تدّعِ نجاح الإجراء. وضّح باختصار أنك لا تستطيع إكماله الآن.',
      UNKNOWN_TOOL:
        'هذه الإمكانية غير متاحة في المكالمة الحالية. لا تحاول استدعاء أداة غير متاحة ولا تدّعِ بدء الإجراء. وضّح باختصار أنها غير متاحة، ولا تعرض متابعة الفريق إلا بعد موافقة واضحة.',
      ROLE_NOT_AUTHORIZED:
        'هذا الإجراء غير متاح للحساب الذي تم التحقق منه. لا تحاول استدعاءه مجددًا ولا تدّعِ تنفيذه. وضّح باختصار أن الإجراء غير متاح لهذا الحساب.',
    },
  };
  return instructions[locale][reason] ?? instructions[locale].INVALID_ARGUMENTS;
}

function failedToolFollowUp(
  tool: string,
  locale: ToolContext['locale'],
  actionUnavailableMessage?: string,
): string {
  if (tool === 'escalate_to_human') {
    return {
      en: 'Say exactly once: “I couldn’t send your follow-up request just now.” It was not submitted; do not say it was denied or rejected by the team, do not claim success, do not ask for contact details again, and do not repeat an apology already given.',
      fr: 'Dites une seule fois : « Je n’ai pas pu envoyer votre demande de suivi pour le moment. » Elle n’a pas été envoyée ; ne dites pas que l’équipe l’a refusée, ne prétendez pas qu’elle a réussi, ne redemandez pas les coordonnées et ne répétez pas des excuses déjà présentées.',
      'ar-SA':
        'قل مرة واحدة: «لم أتمكن من إرسال طلب المتابعة الآن». لم يُرسل الطلب؛ لا تقل إن الفريق رفضه، ولا تدّعِ نجاحه، ولا تطلب بيانات التواصل مجددًا، ولا تكرر اعتذارًا سبق أن قلته.',
    }[locale];
  }
  if (tool === 'verify_member_id') {
    return {
      en: 'Verification did not complete. Do not perform account actions, repeat the member ID, or mention the trusted phone. Briefly say verification is temporarily unavailable and ask the caller to try again later.',
      fr: 'La vérification n’a pas abouti. N’effectuez aucune action sur le compte, ne répétez pas l’identifiant et ne mentionnez pas le numéro de téléphone. Expliquez brièvement que la vérification est temporairement indisponible et demandez à la personne de réessayer plus tard.',
      'ar-SA':
        'لم يكتمل التحقق. لا تنفذ أي إجراء على الحساب ولا تكرر رقم العضوية أو تذكر رقم الهاتف. وضّح باختصار أن التحقق غير متاح مؤقتًا واطلب من المتصل المحاولة لاحقًا.',
    }[locale];
  }
  if (tool === 'search_knowledge') {
    return {
      en: 'The knowledge lookup failed. Do not answer from memory or imply that information was found. Briefly say you cannot access that information right now; offer team follow-up only with the caller’s clear consent.',
      fr: 'La recherche de connaissances a échoué. Ne répondez pas de mémoire et ne laissez pas entendre que l’information a été trouvée. Dites brièvement que vous ne pouvez pas accéder à cette information pour le moment ; ne proposez un rappel de l’équipe qu’avec l’accord clair de la personne.',
      'ar-SA':
        'تعذر البحث في المعلومات. لا تجب من الذاكرة ولا توحِ بأنك وجدت المعلومة. وضّح باختصار أنك لا تستطيع الوصول إليها الآن، ولا تعرض متابعة الفريق إلا بموافقة واضحة من المتصل.',
    }[locale];
  }
  return (
    actionUnavailableMessage ??
    {
      en: 'The tool did not complete. Do not invent a result or claim success. Briefly say you cannot complete the action right now; offer team follow-up only with the caller’s clear consent.',
      fr: 'L’outil n’a pas abouti. N’inventez aucun résultat et ne prétendez pas que l’action a réussi. Dites brièvement que vous ne pouvez pas terminer l’action pour le moment ; ne proposez un rappel de l’équipe qu’avec l’accord clair de la personne.',
      'ar-SA':
        'لم يكتمل تنفيذ الأداة. لا تختلق نتيجة ولا تدّعِ نجاح الإجراء. وضّح باختصار أنك لا تستطيع إكماله الآن، ولا تعرض متابعة الفريق إلا بموافقة واضحة من المتصل.',
    }[locale]
  );
}

// The only way the model reaches server-side behavior. Deny by default: an
// unknown tool, a malformed argument, or an exhausted limit never runs code.
// Every decision is written to tool_invocations.
export class ToolGateway {
  private readonly bookingConfirmation = new BookingConfirmation();
  private readonly cancellationConfirmation = new CancellationConfirmation();
  observeCallerTranscript(sessionId: string, transcript: string): void {
    this.bookingConfirmation.observe(sessionId, transcript);
    this.cancellationConfirmation.observe(sessionId, transcript);
  }

  hasConfirmedCancellation(sessionId: string): boolean {
    return this.cancellationConfirmation.hasConfirmed(sessionId);
  }

  confirmPendingCancellation(sessionId: string): boolean {
    return this.cancellationConfirmation.confirmPending(sessionId);
  }
  private readonly byName: Map<string, RegisteredTool>;

  constructor(
    tools: readonly RegisteredTool[],
    private readonly recorder: ToolInvocationRecorder,
    private readonly logger: Logger,
  ) {
    this.byName = new Map();
    for (const tool of tools) {
      if (this.byName.has(tool.name)) {
        throw new Error(`Duplicate tool registration: ${tool.name}`);
      }
      this.byName.set(tool.name, tool);
    }
  }

  // The tool list set on the call at creation time (server-side only).
  realtimeTools(
    access: {
      customerVerified: boolean;
      serverRole?: string;
      verificationAvailable?: boolean;
    } = {
      customerVerified: false,
    },
  ): RealtimeToolDefinition[] {
    return toRealtimeTools(
      [...this.byName.values()].filter((tool) => {
        if (
          access.verificationAvailable === false &&
          ['request_member_id', 'verify_member_id'].includes(tool.name)
        )
          return false;
        if (tool.access.kind === 'public') {
          return true;
        }
        return (
          access.customerVerified &&
          access.serverRole !== undefined &&
          tool.access.roles.includes(access.serverRole)
        );
      }),
    );
  }

  toolNames(
    access: {
      customerVerified: boolean;
      serverRole?: string;
      verificationAvailable?: boolean;
    } = {
      customerVerified: false,
    },
  ): string[] {
    return this.realtimeTools(access).map((tool) => tool.name);
  }

  // Never rejects: failures become a tool output the model can react to.
  async execute(
    call: ToolCall,
    name: string,
    rawArguments: string,
  ): Promise<ToolExecution> {
    const startedAt = Date.now();
    const deny = (reason: string, argsRedacted: unknown = {}) => {
      if (name === 'escalate_to_human') {
        this.logger.warn(
          {
            source: 'tool-gateway',
            sessionId: call.context.sessionId,
            tool: name,
            denyReason: reason,
          },
          'Escalation tool call denied',
        );
      }
      this.write(call, name, startedAt, {
        argsRedacted,
        decision: 'denied',
        denyReason: reason,
      });
      return {
        output: jsonOutput({ error: 'denied', reason }),
        citations: [],
        endCall: false,
        ...(reason === 'ALREADY_VERIFIED' ? { allowToolCalls: true } : {}),
        ...(reason === 'INVALID_ARGUMENTS' && name === 'verify_member_id'
          ? { sensitiveInputExpected: true }
          : {}),
        followUpInstructions: deniedFollowUp(
          name,
          reason,
          call.context.locale,
          call.context.actionUnavailableMessage,
          call.context.accountAccessHint,
        ),
      };
    };

    const tool = this.byName.get(name);
    if (
      call.context.verificationAvailable === false &&
      ['request_member_id', 'verify_member_id'].includes(name)
    ) {
      return deny('UNKNOWN_TOOL');
    }
    if (!tool) {
      return deny('UNKNOWN_TOOL');
    }

    if (call.customerVerified && name === 'request_member_id') {
      return deny('ALREADY_VERIFIED');
    }

    if (tool.requiresVerifiedCustomer && !call.customerVerified) {
      return deny('ACCOUNT_NOT_VERIFIED');
    }
    if (
      tool.access.kind === 'roles' &&
      (!call.customerVerified ||
        call.serverRole === undefined ||
        !tool.access.roles.includes(call.serverRole))
    ) {
      return deny('ROLE_NOT_AUTHORIZED');
    }

    const callsMade = call.callCounts.get(name) ?? 0;
    if (
      callsMade >= tool.maxCallsPerSession ||
      (callsMade > 0 &&
        tool.canCallAfter &&
        !tool.canCallAfter(call.lastToolStatuses?.get(name)))
    ) {
      return deny('TOOL_LIMIT');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawArguments || '{}');
    } catch {
      return deny('INVALID_ARGUMENTS');
    }

    let toolArguments = parsedJson;
    if (
      name === 'select_cancellation_from_multiple_sessions' ||
      name === 'cancel_course'
    ) {
      const courseId =
        typeof parsedJson === 'object' &&
        parsedJson !== null &&
        !Array.isArray(parsedJson)
          ? (parsedJson as Record<string, unknown>).courseId
          : undefined;
      if (typeof courseId !== 'string') return deny('INVALID_ARGUMENTS');
      const preparedCourseId =
        name === 'select_cancellation_from_multiple_sessions'
          ? this.cancellationConfirmation.prepare(
              call.context.sessionId,
              courseId,
            )
          : this.cancellationConfirmation.consumePrepared(
              call.context.sessionId,
              courseId,
            );
      if (!preparedCourseId)
        return {
          ...deny('CANCELLATION_CONFIRMATION_REQUIRED'),
          followUpInstructions:
            'No session was cancelled. Do not mention a denial reason, system state, confirmation syntax, or ask the caller to repeat the same confirmation. Refresh the upcoming-session list, then follow its instructions: a single session is prepared automatically; for multiple sessions, prepare the selected one, read it back, and wait for explicit confirmation in a new caller turn.',
          allowToolCalls: true,
        };
      if (name === 'cancel_course') {
        toolArguments = { courseId: preparedCourseId };
      }
    }
    if (name === 'prepare_course_booking' || name === 'book_course') {
      if (
        !parsedJson ||
        typeof parsedJson !== 'object' ||
        Array.isArray(parsedJson)
      )
        return deny('INVALID_ARGUMENTS');
      const selection = {
        ...(parsedJson as Record<string, unknown>),
        // Timezone is trusted session context, never a model decision.
        timeZone: call.context.timeZone ?? 'UTC',
      };
      const prepared =
        name === 'prepare_course_booking'
          ? undefined
          : this.bookingConfirmation.consumePrepared(
              call.context.sessionId,
              selection,
            );
      const description =
        name === 'prepare_course_booking'
          ? this.bookingConfirmation.prepare(call.context.sessionId, selection)
          : prepared?.description;
      if (!description) {
        return {
          ...deny('BOOKING_CONFIRMATION_REQUIRED'),
          followUpInstructions:
            'No booking was sent. Refresh availability if needed, call prepare_course_booking for an exact returned slot, read its summary, and wait for the caller to explicitly confirm in a new turn. Never invent consent.',
          allowToolCalls: true,
        };
      }
      toolArguments = {
        ...(name === 'book_course' && prepared
          ? prepared.selection
          : selection),
        description,
      };
    }
    call.callCounts.set(name, callsMade + 1);
    try {
      const result = await tool.invoke(toolArguments, {
        ...call.context,
        callsMade,
        ...(tool.requiresVerifiedCustomer && call.serverAccessToken
          ? { serverAccessToken: call.serverAccessToken }
          : {}),
        ...(tool.requiresVerifiedCustomer && call.serverAccessToken
          ? { serverRole: call.serverRole }
          : {}),
      });
      if (result.kind === 'invalid') {
        // Nothing ran, so the attempt does not use up the tool's quota. The
        // slot was reserved up front so parallel calls cannot exceed the limit.
        call.callCounts.set(
          name,
          Math.max(0, (call.callCounts.get(name) ?? 1) - 1),
        );
        return deny('INVALID_ARGUMENTS');
      }
      const { outcome, argsRedacted } = result;
      if (
        name === 'check_tutor_availability' ||
        name === 'start_course_booking'
      ) {
        this.bookingConfirmation.remember(
          call.context.sessionId,
          parsedJson as Record<string, unknown>,
          outcome.output,
        );
      }
      if (
        name === 'get_my_courses' &&
        typeof parsedJson === 'object' &&
        parsedJson !== null &&
        (parsedJson as Record<string, unknown>).intent === 'cancel'
      )
        this.cancellationConfirmation.remember(
          call.context.sessionId,
          outcome.output,
        );
      if (tool.canCallAfter) {
        const output = outcome.output;
        const status =
          typeof output === 'object' &&
          output !== null &&
          'status' in output &&
          typeof output.status === 'string'
            ? output.status
            : undefined;
        if (status) {
          call.lastToolStatuses ??= new Map();
          call.lastToolStatuses.set(name, status);
        } else {
          call.lastToolStatuses?.delete(name);
        }
      }
      if (typeof outcome.customerVerified === 'boolean') {
        call.customerVerified = outcome.customerVerified;
        if (!outcome.customerVerified) {
          call.serverAccessToken = undefined;
          call.serverRole = undefined;
        }
      }
      if (outcome.customerVerified && outcome.serverAccessToken) {
        call.serverAccessToken = outcome.serverAccessToken;
        call.serverRole = outcome.serverRole;
      }
      if (outcome.accountAccessHint) {
        call.context.accountAccessHint = outcome.accountAccessHint;
      }
      this.write(call, name, startedAt, {
        argsRedacted,
        decision: 'allowed',
        resultSummary: summarize(outcome.output),
      });
      return {
        output: jsonOutput(outcome.output),
        citations: outcome.citations ?? [],
        endCall: outcome.endCall ?? false,
        customerVerified: call.customerVerified,
        ...(call.serverAccessToken
          ? { serverAccessToken: call.serverAccessToken }
          : {}),
        ...(call.serverAccessToken ? { serverRole: call.serverRole } : {}),
        ...(outcome.followUpInstructions
          ? { followUpInstructions: outcome.followUpInstructions }
          : {}),
        ...(outcome.allowToolCalls ? { allowToolCalls: true } : {}),
        ...(outcome.sensitiveInputExpected
          ? { sensitiveInputExpected: true }
          : {}),
      };
    } catch (error) {
      if (error instanceof ToolCallRejectedError) {
        return deny(error.code);
      }
      if (name === 'verify_member_id') {
        call.customerVerified = false;
        call.serverAccessToken = undefined;
        call.serverRole = undefined;
      }
      this.logger.error(
        {
          source: 'tool-gateway',
          sessionId: call.context.sessionId,
          tool: name,
          errorName: errorName(error),
          ...(name === 'escalate_to_human' &&
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string'
            ? { errorCode: error.code }
            : {}),
        },
        'Tool execution failed',
      );
      this.write(call, name, startedAt, {
        argsRedacted: {},
        decision: 'denied',
        denyReason: 'TOOL_FAILED',
        resultSummary: `error:${errorName(error)}`,
      });
      return {
        output: jsonOutput({ error: 'TOOL_FAILED' }),
        citations: [],
        endCall: false,
        ...(name === 'verify_member_id' ? { customerVerified: false } : {}),
        followUpInstructions: failedToolFollowUp(
          name,
          call.context.locale,
          call.context.actionUnavailableMessage,
        ),
      };
    }
  }

  // Recording is best effort: a database problem must not drop the call.
  private write(
    call: ToolCall,
    tool: string,
    startedAt: number,
    entry: Pick<
      ToolInvocationEntry,
      'argsRedacted' | 'decision' | 'denyReason' | 'resultSummary'
    >,
  ): void {
    void this.recorder
      .record({
        sessionId: call.context.sessionId,
        tool,
        latencyMs: Date.now() - startedAt,
        expiresAt: call.recordExpiresAt,
        ...entry,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          {
            source: 'tool-gateway',
            sessionId: call.context.sessionId,
            errorName: errorName(error),
          },
          'Tool invocation could not be recorded',
        );
      });
  }
}

// A short, content-free description of the result for the audit record.
function summarize(output: unknown): string {
  if (typeof output === 'object' && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.found === 'boolean') {
      const count = Array.isArray(record.passages) ? record.passages.length : 0;
      return `found=${record.found} passages=${count}`;
    }
    if (typeof record.ticketRef === 'string') {
      return `ticketRef=${record.ticketRef}`;
    }
    if (typeof record.status === 'string') {
      return `status=${record.status}`;
    }
  }
  return 'ok';
}
