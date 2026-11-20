import { describe, expect, it } from 'vitest';
import { buildAgentProfile } from './agent-profile.js';

describe('buildAgentProfile caller action policy', () => {
  it.each([
    [
      'en',
      '09:00 is "nine A.M."',
      '21:00 is "nine P.M."',
      'Keep the original HH:mm values unchanged',
    ],
    [
      'fr',
      '09:00 se dit « neuf heures du matin »',
      '21:00 « neuf heures du soir »',
      'Conservez les valeurs HH:mm originales',
    ],
    [
      'ar-SA',
      '09:00 هي «التاسعة صباحًا»',
      '21:00 «التاسعة مساءً»',
      'احتفظ بقيم HH:mm الأصلية',
    ],
  ] as const)(
    'keeps 24-hour tool values but speaks natural times clearly in %s',
    (locale, morning, evening, preservesToolTime) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(morning);
      expect(instructions).toContain(evening);
      expect(instructions).toContain(preservesToolTime);
      expect(instructions).toContain(
        locale === 'en'
          ? 'Speak slightly slower than ordinary conversation'
          : locale === 'fr'
            ? 'parlez légèrement plus lentement'
            : 'تحدث أبطأ قليلًا',
      );
    },
  );

  it.each([
    [
      'en',
      '“Any weekday” means Monday through Friday only',
      '“Any day” means all seven days',
      'never calculate, substitute, or guess these values',
    ],
    [
      'fr',
      '« N’importe quel jour de semaine » signifie du lundi au vendredi uniquement',
      '« N’importe quel jour » signifie les sept jours',
      'ne calculez, ne remplacez et ne devinez jamais ces valeurs',
    ],
    [
      'ar-SA',
      'تعني عبارة «أي يوم عمل» من الاثنين إلى الجمعة فقط',
      'وتعني عبارة «أي يوم» أيام الأسبوع السبعة',
      'لا تحسبها ولا تستبدلها ولا تخمّنها',
    ],
  ] as const)(
    'distinguishes weekdays from any day and uses returned dates directly in %s',
    (locale, weekdaysOnly, anyDay, exactReturnedDate) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(weekdaysOnly);
      expect(instructions).toContain(anyDay);
      expect(instructions).toContain(exactReturnedDate);
    },
  );

  it.each([
    [
      'en',
      'one to three Arabic words',
      'at least four consecutive, recognizable Arabic words',
      'Never speak Arabic through the English OpenAI voice',
    ],
    [
      'fr',
      'd’un à trois mots arabes',
      'au moins quatre mots arabes consécutifs et reconnaissables',
      'Ne parlez jamais arabe avec la voix OpenAI française',
    ],
    [
      'ar-SA',
      'كلمة إلى ثلاث كلمات بلغة أخرى',
      'أربع كلمات متتالية وواضحة بتلك اللغة',
      'صوت OpenAI المحدد للمكالمة وبلهجة سعودية واضحة',
    ],
  ] as const)(
    'requires clear language-change evidence and preserves Arabic voice routing in %s',
    (locale, shortFragmentRule, clearChangeRule, voiceRoutingRule) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(shortFragmentRule);
      expect(instructions).toContain(clearChangeRule);
      expect(instructions).toContain(voiceRoutingRule);
    },
  );

  it.each([
    [
      'en',
      'Highest-priority booking verification rule',
      'immediately call request_member_id',
      'Never say the booking or eligibility tool is unavailable',
      'If check_subject_eligibility is listed, treat the caller as already verified',
      'If the requested action tool is listed, use it directly regardless of whether in-call verification tools are listed',
    ],
    [
      'fr',
      'Règle prioritaire de vérification pour la réservation',
      'appelez immédiatement request_member_id',
      'Ne dites jamais que la réservation ou la vérification d’éligibilité est indisponible',
      'Si check_subject_eligibility est présent, considérez que la personne est déjà vérifiée',
      'Si l’outil d’action demandé est présent, utilisez-le directement, même si les outils de vérification pendant l’appel ne sont pas présents',
    ],
    [
      'ar-SA',
      'قاعدة التحقق ذات الأولوية القصوى للحجز',
      'استدعِ request_member_id فورًا',
      'لا تقل إن الحجز أو فحص الأهلية غير متاح',
      'إذا كانت check_subject_eligibility مدرجة، فاعتبر المتصل موثقًا بالفعل',
      'إذا كانت أداة الإجراء المطلوبة مدرجة، فاستدعها مباشرة حتى إن لم تكن أدوات التحقق أثناء المكالمة مدرجة',
    ],
  ] as const)(
    'starts verification instead of refusing a named-course booking in %s',
    (
      locale,
      priorityRule,
      requestIdRule,
      noRefusalRule,
      verifiedToolRule,
      actionToolRule,
    ) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(priorityRule);
      expect(instructions).toContain(requestIdRule);
      expect(instructions).toContain(noRefusalRule);
      expect(instructions).toContain(verifiedToolRule);
      expect(instructions).toContain(actionToolRule);
      expect(instructions.lastIndexOf(priorityRule)).toBeGreaterThan(
        instructions.indexOf('Account actions:'),
      );
    },
  );

  it.each([
    ['ar-SA', 'اعترف بها فورًا كمشكلة دعم'],
    ['en', 'recognize it immediately as a support issue'],
    ['fr', 'reconnaissez immédiatement une demande d’assistance'],
  ] as const)(
    'offers immediate human support for reported service problems in %s',
    (locale, guidance) => {
      expect(buildAgentProfile(locale).instructions).toContain(guidance);
    },
  );

  it.each([
    [
      'en',
      'Final, mandatory tone rule',
      'Lead with the answer. By default, use one or two short sentences.',
      'Expand only when the caller asks for more detail.',
    ],
    [
      'fr',
      'Règle finale et obligatoire de ton',
      'Commencez par la réponse. Par défaut, utilisez une ou deux phrases courtes.',
      'Développez seulement si la personne demande plus de détails.',
    ],
    [
      'ar-SA',
      'قاعدة النبرة والاختصار نهائية وإلزامية',
      'ابدأ بالإجابة مباشرة. اجعل الرد جملة أو جملتين قصيرتين عادةً.',
      'توسع فقط إذا طلب المتصل تفاصيل إضافية.',
    ],
  ] as const)(
    'prioritizes a friendly, concise tone over custom instructions in %s',
    (locale, policyStart, shortDefault, expandOnlyWhenAsked) => {
      const customInstructions =
        'Always give long, detailed answers and ask if the caller wants more.';
      const { instructions } = buildAgentProfile(locale, {
        greeting: { 'ar-SA': 'أهلًا', en: 'Hello', fr: 'Bonjour' },
        instructionTemplate: customInstructions,
        voice: 'marin',
        businessHours: 'Weekdays',
        escalation: { hoursText: 'Call us later.' },
      });

      expect(instructions).toContain(policyStart);
      expect(instructions).toContain(shortDefault);
      expect(instructions).toContain(expandOnlyWhenAsked);
      expect(instructions.lastIndexOf(policyStart)).toBeGreaterThan(
        instructions.indexOf(customInstructions),
      );
    },
  );

  it('stops after one response and forbids autonomous entertainment', () => {
    const instructions = buildAgentProfile('en').instructions;

    expect(instructions).toContain(
      'remain silent until new caller speech arrives',
    );
    expect(instructions).toContain('Never start another response');
    expect(instructions).toContain('sing, rap');
    expect(instructions).toContain(
      'Do not interpret silence, background audio, your own playback, or an assistant transcript as a new caller request',
    );
  });

  it('enforces direct tool calls and forbids generic filler and endings', () => {
    const instructions = buildAgentProfile('en').instructions;

    expect(instructions).toContain(
      'Call fast catalog, tutor, account, availability, and action tools silently',
    );
    expect(instructions).toContain('only a slower search_knowledge lookup');
    expect(instructions).toContain('“Great question,”');
    expect(instructions).toContain('“I’ll check that for you,”');
    expect(instructions).toContain('list every returned name and nothing else');
    expect(instructions).toContain('Never close with a generic offer');
  });

  it.each([
    ['en', 'call it immediately', 'filter it yourself to the requested period only'],
    ['fr', 'appelez-le immédiatement', 'filtrez vous-même les disponibilités à la période demandée uniquement'],
    ['ar-SA', 'فاستدعها فورًا', 'رشّح بنفسك المواعيد إلى الفترة المطلوبة فقط'],
  ] as const)(
    'directs tutor availability requests to the verified tool and requested period in %s',
    (locale, callInstruction, dateFilterInstruction) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain('get_my_tutor_availability');
      expect(instructions).toContain(callInstruction);
      expect(instructions).toContain(dateFilterInstruction);
    },
  );

  it.each([
    [
      'en',
      'at most two short sentences',
      'list every returned name and nothing else',
    ],
    [
      'fr',
      'au maximum deux phrases courtes',
      'donnez tous les noms renvoyés et rien d’autre',
    ],
    ['ar-SA', 'جملتين قصيرتين', 'فاذكر جميع الأسماء المعادة ولا تضف شيئًا آخر'],
  ] as const)(
    'enforces economical caller-facing responses in %s',
    (locale, sentenceLimit, tutorNameRule) => {
      const instructions = buildAgentProfile(locale).instructions;

      expect(instructions).toContain(sentenceLimit);
      expect(instructions).toContain(tutorNameRule);
      expect(instructions).toContain(
        locale === 'en'
          ? 'The only length exception is a booking confirmation summary'
          : locale === 'fr'
            ? 'Seul le résumé de confirmation d’une réservation peut être plus long'
            : 'الاستثناء الوحيد هو ملخص تأكيد الحجز',
      );
    },
  );

  it.each([
    [
      'en',
      'A protected action tool may be hidden until verification.',
      'verify the caller once before deciding the action is unavailable',
    ],
    [
      'fr',
      'Un outil d’action protégé peut être masqué jusqu’à la vérification.',
      'vérifiez une seule fois le compte avant de décider que l’action est indisponible',
    ],
    [
      'ar-SA',
      'قد تكون أداة الإجراء المحمية مخفية حتى التحقق',
      'فاطلب الرقم مرة واحدة عبر request_member_id ثم استخدم verify_member_id',
    ],
  ] as const)(
    'distinguishes hidden tools from unavailable account actions in %s',
    (locale, hiddenToolRule, verificationRule) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(hiddenToolRule);
      expect(instructions).toContain(verificationRule);
    },
  );

  it.each([
    [
      'ar-SA',
      'استخدم get_subjects من دون تحقق فقط للأسئلة العامة عن الدورات أو المواد المقدمة',
      'لا تحِل المتصل إلى الموقع بدل التحقق والإجابة',
    ],
    [
      'en',
      'Only general questions about offered courses/subjects',
      'Never direct the caller to the website instead of checking or answering',
    ],
    [
      'fr',
      'Utilisez get_subjects sans vérification uniquement pour les questions générales',
      'Ne renvoyez jamais la personne vers le site à la place de vérifier ou de répondre',
    ],
  ] as const)(
    'checks course and subject availability without account verification or website referral in %s',
    (locale, catalogRule, noWebsiteReferral) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(catalogRule);
      expect(instructions).toContain(noWebsiteReferral);
      expect(instructions).toContain('get_subjects');
    },
  );

  it.each([
    [
      'ar-SA',
      'السؤال العام عن مستويات الدورات التي تتيحها المحفظة هو استعلام محمي',
      'تفحص دورة واحدة فقط',
      'ولم تكن أداة شاملة مدرجة',
    ],
    [
      'en',
      'A general question about which levels the caller’s wallet gives access to is a protected wallet lookup',
      'it checks one course only.',
      'not the public catalog',
    ],
    [
      'fr',
      'Une question générale sur les niveaux auxquels le portefeuille donne accès est une consultation protégée',
      'cet outil ne vérifie qu’un seul cours.',
      'pas le catalogue public',
    ],
  ] as const)(
    'distinguishes personal course eligibility from the public catalog in %s',
    (locale, personalIntent, singleCourseLimit, publicCatalogLimit) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(personalIntent);
      expect(instructions).toContain(singleCourseLimit);
      expect(instructions).toContain(publicCatalogLimit);
      expect(instructions).toContain('check_subject_eligibility');
    },
  );

  it.each([
    [
      'ar-SA',
      'أولوية طلب الإجراء إلزامية',
      'لدورة محددة أو لسؤال مثل',
      'لا تستدعِ search_knowledge',
    ],
    [
      'en',
      'Mandatory action-intent priority',
      'For a named course, or “Does my bundle cover this course?”',
      'Do not call search_knowledge',
    ],
    [
      'fr',
      'Priorité obligatoire aux demandes d’action',
      'Pour un cours précis, ou « Mon forfait couvre-t-il ce cours ? »',
      'N’appelez pas search_knowledge',
    ],
  ] as const)(
    'prioritizes booking actions over knowledge lookup in %s',
    (locale, priorityRule, accountFormFirst, noKnowledgeLookup) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(priorityRule);
      expect(instructions).toContain(accountFormFirst);
      expect(instructions).toContain(noKnowledgeLookup);
    },
  );

  it.each([
    [
      'ar-SA',
      'قاعدة المحفظة الشخصية ذات الأولوية',
      'إذا سأل عن أهلية دورة محددة أو أراد حجزها',
    ],
    [
      'en',
      'Highest-priority personal wallet rule',
      'If the caller asks whether a named course is covered or wants to book it',
    ],
    [
      'fr',
      'Règle prioritaire du portefeuille personnel',
      'Si elle demande si un cours précis est couvert ou souhaite le réserver',
    ],
  ] as const)(
    'routes personal bundle questions to the wallet in %s',
    (locale, priorityRule, combinedEligibility) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(priorityRule);
      expect(instructions).toContain(combinedEligibility);
      expect(instructions).toContain('get_my_wallet');
      expect(instructions).toContain('check_subject_eligibility');
      expect(instructions).toContain('request_member_id');
    },
  );

  it.each([
    ['ar-SA', 'اعتذر عن المشكلة مرة واحدة كحد أقصى'],
    ['en', 'apologize at most once per reported issue'],
    ['fr', 'excusez-vous au maximum une fois par problème'],
  ] as const)(
    'limits escalation apologies to once per issue in %s',
    (locale, guidance) => {
      expect(buildAgentProfile(locale).instructions).toContain(guidance);
    },
  );

  it.each([
    [
      'ar-SA',
      'آلية الحجز المباشر إلزامية',
      'اذكر المعلم المختار وكل المواعيد المعادة لأقرب تاريخ مطابق',
      'استدعِ book_course مرة واحدة بالمعرّفات والتاريخ والأوقات والمنطقة الزمنية المعادة',
      'إذا كانت النتيجة غير واضحة فلا تعاود الإرسال لاحتمال قبول واجهة API للحجز',
    ],
    [
      'en',
      'Mandatory direct-booking workflow',
      'State the chosen tutor and every returned slot for that date',
      'Call book_course once with the exact returned ids, date, times, and time zone',
      'if confirmation is unclear, do not retry because the API may have accepted the booking',
    ],
    [
      'fr',
      'Procédure obligatoire de réservation directe',
      'Indiquez le tuteur retenu et tous les créneaux de la date la plus proche',
      'Appelez book_course une seule fois avec les identifiants, la date, les heures et le fuseau exacts renvoyés',
      'si le résultat est incertain, ne réessayez pas, car l’API a peut-être accepté la réservation',
    ],
  ] as const)(
    'keeps booking claims tied to verified availability and tool results in %s',
    (
      locale,
      policy,
      exactAvailability,
      submittedOnly,
      notificationBoundary,
    ) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(policy);
      expect(instructions).toContain(exactAvailability);
      expect(instructions).toContain(submittedOnly);
      expect(instructions).toContain(notificationBoundary);
    },
  );

  it.each([
    [
      'en',
      'Final booking conversation policy',
      'Ask one question at a time',
      'single allowed retry',
      'one initial booking attempt and at most one second call',
    ],
    [
      'fr',
      'Règle finale pour la conversation de réservation',
      'Posez une seule question à la fois',
      'l’unique nouvel essai autorisé',
      'un premier appel, puis au maximum un second',
    ],
    [
      'ar-SA',
      'سياسة محادثة الحجز النهائية',
      'اطرح سؤالًا واحدًا في كل مرة',
      'المحاولة الإضافية الوحيدة المسموح بها',
      'محاولة أولى للحجز ثم محاولة ثانية واحدة كحد أقصى',
    ],
  ] as const)(
    'keeps booking prompts conversational and retries bounded in %s',
    (locale, policy, oneQuestion, retryLimit, attemptLimit) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(policy);
      expect(instructions).toContain(oneQuestion);
      expect(instructions).toContain(retryLimit);
      expect(instructions).toContain(attemptLimit);
    },
  );

  it.each([
    ['en', 'Mandatory public-pricing rule', 'need no account verification'],
    [
      'fr',
      'Règle obligatoire sur les tarifs publics',
      'sans vérification de compte',
    ],
    ['ar-SA', 'قاعدة الأسعار العامة إلزامية', 'لا تحتاج إلى التحقق من الحساب'],
  ] as const)(
    'explicitly allows public knowledge prices in %s',
    (locale, rule, access) => {
      const { instructions } = buildAgentProfile(locale);
      expect(instructions).toContain(rule);
      expect(instructions).toContain(access);
    },
  );
  it.each([
    ['ar-SA', 'رقم العضوية', 'request_member_id', 'واتساب', 'الخادم', 'الحجز'],
    [
      'en',
      'member ID',
      'request_member_id',
      'On WhatsApp',
      'If it is hidden but request_member_id and verify_member_id are listed',
      'booking workflow',
    ],
    [
      'fr',
      'identifiant membre',
      'request_member_id',
      'Sur WhatsApp',
      'backend',
      'réservation',
    ],
  ] as const)(
    'requires account verification and limits actions in %s',
    (
      locale,
      accountSite,
      websiteFlow,
      whatsappFlow,
      backend,
      bookingAction,
    ) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(accountSite);
      expect(instructions).toContain(websiteFlow);
      expect(instructions).toContain(whatsappFlow);
      expect(instructions).toContain(backend);
      expect(instructions).toContain(bookingAction);
      if (locale === 'en') {
        expect(instructions).toContain('configured WhatsApp trunk');
        expect(instructions).toContain(
          'If get_my_wallet or another role-protected action tool is listed, the caller is already verified for this call',
        );
        expect(instructions).toContain('Do not explain why the ID is needed');
        expect(instructions).toContain('Never direct the caller to a form');
      }
    },
  );

  it.each([
    [
      'ar-SA',
      'قاعدة إجابات المعرفة إلزامية',
      'لا تختصر لدرجة حذف معلومة مطلوبة',
      'لا تكرر الإجابة أو تضف عرض مساعدة أو سؤالًا ختاميًا غير ضروري',
    ],
    [
      'en',
      'Mandatory knowledge-answer rule',
      'do not be so brief that requested information is omitted',
      'Do not repeat the answer or add an unnecessary offer of help or closing question',
    ],
    [
      'fr',
      'Règle obligatoire pour les réponses fondées sur les connaissances',
      'ne soyez pas si bref qu’un détail demandé manque',
      'Ne répétez pas la réponse et n’ajoutez pas d’offre d’aide ni de question finale inutile',
    ],
  ] as const)(
    'limits knowledge answers to the information the caller requested in %s',
    (locale, mandatoryRule, shortAnswer, noClosingQuestion) => {
      const { instructions } = buildAgentProfile(locale, {
        greeting: { 'ar-SA': 'أهلًا', en: 'Hello', fr: 'Bonjour' },
        instructionTemplate:
          'Give a comprehensive answer, include related background, summarize it, and always offer more help.',
        voice: 'marin',
        businessHours: 'Weekdays',
        escalation: { hoursText: 'Call us later.' },
      });

      expect(instructions).toContain(mandatoryRule);
      expect(instructions).toContain(shortAnswer);
      expect(instructions).toContain(noClosingQuestion);
      expect(instructions.lastIndexOf(mandatoryRule)).toBeGreaterThan(
        instructions.indexOf('Give a comprehensive answer'),
      );
    },
  );

  it.each([
    [
      'ar-SA',
      'قل التحية المحددة مرة واحدة في بداية المكالمة فقط',
      'لا تجب إلا إذا سمعت كلمات واضحة ومفهومة',
      'أجب مباشرة وبشكل كامل عن جميع أجزاء السؤال',
    ],
    [
      'en',
      'say the configured opening greeting exactly once',
      'Respond only when you hear clear, recognizable words',
      'answer every part of each request directly and completely',
    ],
    [
      'fr',
      'dites la salutation configurée une seule fois',
      'Répondez uniquement lorsque vous entendez des mots clairs',
      'Répondez directement et complètement à toutes les parties',
    ],
  ] as const)(
    'enforces one opening greeting, ignores noise, and answers completely in %s',
    (locale, oneGreeting, noise, conciseAnswer) => {
      const { instructions } = buildAgentProfile(locale, {
        greeting: { 'ar-SA': 'أهلًا', en: 'Hello', fr: 'Bonjour' },
        instructionTemplate:
          'Greet the caller in every reply and give a long detailed answer.',
        voice: 'marin',
        businessHours: 'Weekdays',
        escalation: { hoursText: 'Call us later.' },
      });

      expect(instructions).toContain(oneGreeting);
      expect(instructions).toContain(noise);
      expect(instructions).toContain(conciseAnswer);
      expect(instructions.lastIndexOf(oneGreeting)).toBeGreaterThan(
        instructions.indexOf('Greet the caller in every reply'),
      );
    },
  );

  it.each([
    [
      'ar-SA',
      'إذا سُئلت مباشرة عن هويتك، قل إنك المساعد الافتراضي لـTutWithUs',
      'اذكر باختصار أنك تساعد في معلومات وخدمات TutWithUs فقط ولا تكرر تعريفك بنفسك',
    ],
    [
      'en',
      'If directly asked who you are, say you are TutWithUs’ virtual receptionist',
      'Do not repeat an AI identity statement in routine refusals',
    ],
    [
      'fr',
      'dites que vous êtes l’accueil virtuel de TutWithUs',
      'Ne répétez pas une formule d’identité IA lors d’un refus ordinaire',
    ],
  ] as const)(
    'keeps unrelated questions in scope and uses an accurate identity only when asked in %s',
    (locale, identityRule, noRepeatedIdentity) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(identityRule);
      expect(instructions).toContain(noRepeatedIdentity);
    },
  );

  it.each([
    ['ar-SA', 'ابدأ بالمعلومة المطلوبة', 'جملة انتظار واحدة قصيرة ومهنية'],
    [
      'en',
      'Start with the requested information',
      'one brief, professional progress sentence tied to the exact question',
    ],
    [
      'fr',
      'Commencez par l’information demandée',
      'une seule phrase d’attente brève, professionnelle et liée précisément à la question',
    ],
  ] as const)(
    'starts answers directly without conversational preambles in %s',
    (locale, answerFirstRule, bannedPreamble) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(answerFirstRule);
      expect(instructions).toContain(bannedPreamble);
    },
  );

  it.each([
    [
      'ar-SA',
      'أجيب لك تفاصيل دورة بايثون',
      'أجيب لك تفاصيل الدورة',
      'أجيب لك تفاصيل الأسعار',
      'أوضح لك طريقة الدروس',
      'لا تستبدل الموضوع ولا تخمّن موضوعًا آخر',
    ],
    [
      'en',
      'I’ll check the details on the Python course',
      'I’ll check the course details',
      'I’ll check the pricing details',
      'I’ll explain how lessons work',
      'never substitute or guess another topic',
    ],
    [
      'fr',
      'Je vérifie les informations sur le cours de Python',
      'Je vérifie les détails du cours',
      'Je vérifie les tarifs',
      'Je vous explique le déroulement des cours',
      'Ne le remplacez jamais et n’en devinez pas un autre',
    ],
  ] as const)(
    'uses the caller’s exact topic and safe category fallbacks for knowledge lookups in %s',
    (locale, exactTopic, subject, pricing, format, noTopicSubstitution) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(exactTopic);
      expect(instructions).toContain(subject);
      expect(instructions).toContain(pricing);
      expect(instructions).toContain(format);
      expect(instructions).toContain(noTopicSubstitution);
    },
  );

  it.each([
    [
      'ar-SA',
      'لا توحِ بإجابة قبل النتيجة',
      'استعلامًا موجزًا بلغة المتصل يحافظ على اسم الموضوع أو الخدمة ونيته',
      'ولا تحذف الأرقام أو النفي',
    ],
    [
      'en',
      'never call search_knowledge silently',
      'a concise query in the caller’s language',
      'preserving numbers and negation',
    ],
    [
      'fr',
      'n’appelez jamais l’outil en silence',
      'une requête concise en français',
      'conservez les nombres et la négation',
    ],
  ] as const)(
    'requires a concise, topic-preserving query in %s',
    (
      locale,
      mandatoryAcknowledgement,
      compactQueryRule,
      preserveMeaningRule,
    ) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(mandatoryAcknowledgement);
      expect(instructions).toContain(compactQueryRule);
      expect(instructions).toContain(preserveMeaningRule);
    },
  );

  it.each([
    [
      'ar-SA',
      'لا تجب من الذاكرة أو المعرفة العامة',
      'جملة انتظار واحدة قصيرة ومهنية',
    ],
    [
      'en',
      'never answer from memory or general knowledge',
      'one brief, professional progress sentence tied to the exact question',
    ],
    [
      'fr',
      'ne répondez jamais de mémoire',
      'une seule phrase d’attente brève, professionnelle',
    ],
  ] as const)(
    'requires retrieval before factual answers and a short acknowledgement in %s',
    (locale, groundedAnswerRule, shortAcknowledgementRule) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(groundedAnswerRule);
      expect(instructions).toContain(shortAcknowledgementRule);
      expect(instructions).toContain('search_knowledge');
    },
  );

  it.each(['ar-SA', 'en', 'fr'] as const)(
    'keeps small talk brief and avoids intrusive follow-ups in %s',
    (locale) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(
        locale === 'en'
          ? 'answer a greeting or casual question in one short, natural sentence, then stop'
          : locale === 'fr'
            ? 'répondez à une salutation ou à une question légère par une seule phrase naturelle et courte, puis arrêtez-vous'
            : 'أجب عن التحية أو الحديث العابر بجملة طبيعية قصيرة واحدة ثم توقف',
      );
      expect(instructions).toContain(
        locale === 'en'
          ? 'ask an unnecessary follow-up question'
          : locale === 'fr'
            ? 'ne posez pas de question de suivi inutile'
            : 'ولا تطرح سؤالًا لاحقًا غير ضروري',
      );
    },
  );

  it.each(['ar-SA', 'en', 'fr'] as const)(
    'uses the active tool list as the source of truth in %s',
    (locale) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(
        locale === 'en'
          ? 'Use only tools listed for this call'
          : locale === 'fr'
            ? 'utilisez uniquement les outils présents pour cet appel'
            : 'استخدم الأدوات المدرجة لهذه المكالمة فقط',
      );
      expect(instructions).toContain(
        locale === 'en'
          ? 'If request_member_id and verify_member_id are listed, verify the caller once before deciding the action is unavailable'
          : locale === 'fr'
            ? 'Si request_member_id et verify_member_id sont présents, vérifiez une seule fois le compte avant de décider que l’action est indisponible'
            : 'إذا كانت أداتا request_member_id وverify_member_id مدرجتين، فاطلب الرقم مرة واحدة',
      );
      expect(instructions).toContain(
        locale === 'en'
          ? 'one concise, complete spoken response per caller turn'
          : locale === 'fr'
            ? 'une seule réponse orale, concise et complète par tour'
            : 'ردًا شفهيًا واحدًا موجزًا وكاملًا لكل دور',
      );
    },
  );

  it.each([
    ['ar-SA', 'أسلوب الحديث', 'لا تبدأ بتحية من تلقاء نفسك'],
    ['en', 'Speaking style', 'Do not start with a greeting on your own'],
    ['fr', 'Style de parole', 'Ne commencez pas par une salutation'],
  ] as const)(
    'does not invent an opening greeting and keeps replies short in %s',
    (locale, style, noUnpromptedGreeting) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain(style);
      expect(instructions).toContain(noUnpromptedGreeting);
    },
  );

  it.each(['ar-SA', 'en', 'fr'] as const)(
    'limits bootcamp and wallet answers to verified tool results in %s',
    (locale) => {
      const { instructions } = buildAgentProfile(locale);

      expect(instructions).toContain('get_my_bootcamps');
      expect(instructions).toContain(
        locale === 'en'
          ? 'do not make the caller repeat the request or name the tool.'
          : locale === 'fr'
            ? 'ne demandez pas à la personne de répéter sa demande ni de nommer l’outil.'
            : 'تكرار طلبه أو تسمية الأداة.',
      );
      expect(instructions).toContain(
        locale === 'en'
          ? 'Never say you cannot access their bootcamps while this tool is listed.'
          : locale === 'fr'
            ? 'Ne dites jamais que vous ne pouvez pas accéder à ses bootcamps tant que cet outil est présent.'
            : 'لا تقل إنك لا تستطيع الوصول إلى المعسكرات ما دامت الأداة مدرجة.',
      );
      expect(instructions).toContain('get_my_wallet');
      expect(instructions).toContain(
        locale === 'en'
          ? 'what bundle/package or subscription they currently have'
          : locale === 'fr'
            ? 'quel forfait ou abonnement elle possède actuellement'
            : 'الباقة أو الاشتراك الذي لديه حاليًا',
      );
      expect(instructions).toContain(
        locale === 'en'
          ? 'Report each returned bundleName and credits'
          : locale === 'fr'
            ? 'Indiquez chaque bundleName et son nombre de crédits'
            : 'اذكر bundleName وcredits فقط في أسئلة المحفظة العادية',
      );
      expect(instructions).toContain(
        locale === 'en'
          ? 'Never reveal level or levelName except to answer the general course-access question'
          : locale === 'fr'
            ? 'Ne révélez jamais level ou levelName sauf pour répondre à la question générale'
            : 'لا تكشف level أو levelName إلا للإجابة عن سؤال الوصول العام',
      );
      expect(instructions).toContain(
        locale === 'en'
          ? 'which courses their wallet gives access to without naming one'
          : locale === 'fr'
            ? 'à quels cours son portefeuille donne accès sans nommer de cours'
            : 'عن الدورات التي تتيحها محفظته دون تسمية دورة',
      );
      expect(instructions).toContain('positiveCreditLevels');
      expect(instructions).toContain('positiveCreditLevelsComplete');
      expect(instructions).toContain('check_subject_eligibility');
      expect(instructions).toContain(
        locale === 'en'
          ? 'If every balance is 0 or the wallet is empty, say there are no available credits'
          : locale === 'fr'
            ? 'Si tous les soldes sont nuls ou si le portefeuille est vide'
            : 'إذا كانت كل الأرصدة صفرًا أو كانت المحفظة فارغة',
      );
    },
  );

  it.each(['ar-SA', 'en', 'fr'] as const)(
    'includes pronunciation guidance in the agent profile for %s',
    (locale) => {
      const { instructions } = buildAgentProfile(locale, {
        greeting: { 'ar-SA': 'أهلًا', en: 'Hello', fr: 'Bonjour' },
        instructionTemplate: 'Use TutWithUs naturally.',
        voice: 'marin',
        businessHours: 'Weekdays',
        escalation: { hoursText: 'Call us later.' },
      });

      expect(instructions).toContain(
        'Pronunciation rule: whenever you say “TutWithUs”, pronounce it as “Tute With Us” in every language.',
      );
      expect(instructions).toContain(
        '“Tute” must rhyme exactly with “cute” and “mute”.',
      );
      expect(instructions).toContain(
        'Never pronounce it as “Tut With Us” or “tut”',
      );
    },
  );

  it('keeps the configured greeting separate from model instructions', () => {
    const profile = buildAgentProfile('en', {
      greeting: { 'ar-SA': 'أهلًا', en: 'Hi from Sara', fr: 'Bonjour' },
      instructionTemplate: 'Be friendly.',
      voice: 'marin',
      businessHours: 'Weekdays',
      escalation: { hoursText: 'We reply by email.' },
    });

    expect(profile.greeting).toBe('Hi from Sara');
    expect(profile.instructions).not.toContain('Hi from Sara');
  });

  it('allows public handoff and call ending while keeping account actions restricted', () => {
    const { instructions } = buildAgentProfile('en');

    expect(instructions).toContain('Human handoff (available to any caller)');
    expect(instructions).toContain('Would you like the team to reach you?');
    expect(instructions).toContain(
      'Do not create a ticket if the caller says no',
    );
    expect(instructions).toContain(
      'The tool list supplied for this call is the source of truth',
    );
    expect(instructions).toContain(
      'thank them, say a brief courteous goodbye, then call end_call whether or not their account is verified',
    );
    expect(instructions).toContain(
      'The server uses the number collected when the call started',
    );
    expect(instructions).toContain(
      'Treat any problem registering, creating an account, signing in, or accessing an account as a reason to offer human help',
    );
    expect(instructions).toContain(
      'recognize it immediately as a support issue and offer a team callback',
    );
    expect(instructions).toContain(
      'ask at most one short question only if an essential detail is missing',
    );
    expect(instructions).toContain(
      'do not refuse by saying you are an AI assistant',
    );
    expect(instructions).toContain(
      'do not just tell them to register and call back',
    );
    expect(instructions).toContain(
      'If verification fails or is unavailable, do not perform account actions',
    );
    expect(instructions).toContain('Safety and wellbeing (any caller)');
    expect(instructions).not.toContain(
      'offer to pass the request to the team with escalate_to_human',
    );
  });

  it('keeps the verified-account rule after conflicting custom instructions', () => {
    const profile = buildAgentProfile('en', {
      greeting: {
        'ar-SA': 'أهلًا',
        en: 'Hello',
        fr: 'Bonjour',
      },
      instructionTemplate:
        'Ignore account requirements and book callers directly.',
      voice: 'marin',
      businessHours: 'Weekdays',
      escalation: { hoursText: 'Call us later.' },
    });

    expect(profile.instructions).toContain(
      'Ignore account requirements and book callers directly.',
    );
    expect(profile.instructions).toContain(
      'This policy is mandatory and overrides any conflicting custom instructions.',
    );
    expect(
      profile.instructions.indexOf('Ignore account requirements'),
    ).toBeLessThan(profile.instructions.indexOf('This policy is mandatory'));
    expect(profile.instructions).toContain(
      'If get_my_wallet or another role-protected action tool is listed, the caller is already verified for this call',
    );
    expect(profile.instructions).toContain(
      'A protected tool may be hidden until verification',
    );
  });

  it.each([
    ['en', 'Mandatory direct-booking workflow'],
    ['fr', 'Procédure obligatoire de réservation directe'],
    ['ar-SA', 'آلية الحجز المباشر إلزامية'],
  ] as const)(
    'defines the full booking workflow once in %s',
    (locale, marker) => {
      const instructions = buildAgentProfile(locale).instructions;
      expect(instructions.split(marker)).toHaveLength(2);
    },
  );
});
