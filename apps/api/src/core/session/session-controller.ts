import { randomUUID } from 'node:crypto';
import { errorName, type Logger } from '../../lib/logger.js';
import type { ToolGateway } from '../tools/tool-gateway.js';
import type { Citation, ToolContext } from '../tools/tool-registry.js';
import type {
  AccountCheckOutcome,
  RealtimeServerEvent,
  RealtimeSideband,
  SidebandCloseInfo,
} from './session-ports.js';
import { containsRecognizableWords } from './recognizable-transcript.js';

const TICK_MS = 1_000;
// If the model never finishes its goodbye, end the call anyway.
const GOODBYE_TIMEOUT_MS = 10_000;
import { accountAccessPolicy } from './account-access-policy.js';
import { routeCallerTurn, type TurnRoute } from './turn-router.js';
import { turnResponseContract } from './turn-response-contract.js';
import { ConversationContext } from './conversation-context.js';

const MAX_TURN_CHARACTERS = 2_000;
const MAX_CITATIONS_PER_TURN = 10;
const STATEFUL_BOOKING_TOOLS = new Set([
  'start_course_booking',
  'prepare_course_booking',
  'book_course',
]);
const GOODBYE_INSTRUCTIONS =
  'Say one brief, polite goodbye in the language the caller has been using, then stop. Do not call any tools and do not ask questions.';

function callerTurnPriorityInstructions(locale: ToolContext['locale']): string {
  return {
    en: 'Prioritize the caller’s latest intent on every turn. For public catalog questions, call get_subjects when listed; do not use search_knowledge. For a general question about courses their wallet gives access to without a named course, treat it as a protected wallet request: verify if needed, call get_my_wallet with includeCourseAccessLevels=true, report positiveCreditLevels only, and say these are levels with positive credits rather than confirmation for every individual course. If positiveCreditLevelsComplete is false, say the list is partial. Invite them to name a specific course and call check_subject_eligibility when they do. Treat eligibility and booking requests for a named course as protected actions. If check_subject_eligibility is listed, the caller is verified; otherwise request the member ID and verify once before calling it. Call check_subject_eligibility once with the course name; do not separately call get_subjects or get_my_wallet. Only if eligible and booking or availability was explicitly requested, pass the returned subjectId and levelId unchanged to find_booking_tutors instead of asking the caller to choose a level. Continue using only listed tools and returned ids. Say an action is unavailable only when its required action tool is absent after the account status is known. Missing in-call verification tools do not block an already verified caller; when check_subject_eligibility is listed, call it directly. Give one concise response per caller turn and never repeat a callback offer.',
    fr: 'Priorisez l’intention la plus récente de la personne à chaque tour. Pour les questions publiques sur le catalogue, appelez get_subjects s’il est présent ; n’utilisez pas search_knowledge. Pour une question générale, sans cours précis, sur les cours auxquels son portefeuille donne accès, traitez-la comme une consultation protégée du portefeuille : vérifiez si nécessaire, appelez get_my_wallet avec includeCourseAccessLevels=true, indiquez uniquement positiveCreditLevels et précisez qu’il s’agit de niveaux avec des crédits positifs, pas d’une confirmation pour chaque cours. Si positiveCreditLevelsComplete est false, précisez que la liste est partielle. Invitez la personne à nommer un cours précis et appelez check_subject_eligibility lorsqu’elle le fait. Traitez l’éligibilité ou la réservation d’un cours précis comme une action protégée. Si check_subject_eligibility est présent, la personne est vérifiée ; sinon, demandez son identifiant et vérifiez-le une seule fois avant l’appel. Appelez check_subject_eligibility une seule fois avec le nom du cours ; n’appelez pas séparément get_subjects ni get_my_wallet. En cas d’éligibilité et uniquement pour une demande explicite de réservation ou de disponibilités, transmettez les subjectId et levelId renvoyés sans les modifier à find_booking_tutors au lieu de demander de choisir un niveau. Continuez uniquement avec les outils présents et les identifiants renvoyés. Dites qu’une action est indisponible uniquement si l’outil d’action requis est absent une fois le statut du compte connu. L’absence d’outils de vérification pendant l’appel ne bloque pas une personne déjà vérifiée ; si check_subject_eligibility est présent, appelez-le directement. Donnez une seule réponse concise par tour et ne répétez jamais une offre de rappel.',
    'ar-SA':
      'أعطِ الأولوية لنية المتصل الأحدث في كل دور. لأسئلة القائمة العامة، استدعِ get_subjects إذا كانت مدرجة ولا تستخدم search_knowledge. إذا سأل بشكل عام عن الدورات التي تتيحها محفظته دون تسمية دورة، فتعامل مع الطلب كاستعلام محمي عن المحفظة: تحقّق عند الحاجة، ثم استدعِ get_my_wallet مع includeCourseAccessLevels=true واذكر positiveCreditLevels فقط، مع توضيح أنها مستويات فيها أرصدة موجبة وليست تأكيدًا لأهلية كل دورة. إذا كانت positiveCreditLevelsComplete تساوي false، فوضّح أن القائمة جزئية. اطلب منه تسمية دورة محددة واستدعِ check_subject_eligibility عندما يذكرها. تعامل مع أهلية دورة محددة أو حجزها كإجراء محمي. إذا كانت check_subject_eligibility مدرجة فهذا يعني أن التحقق تم؛ وإلا فاطلب رقم العضوية وتحقق مرة واحدة قبل استدعائها. استدعِ check_subject_eligibility مرة واحدة مع اسم الدورة، ولا تستدعِ get_subjects أو get_my_wallet منفصلتين. عند الأهلية ووجود طلب صريح للحجز أو المعلمين، مرّر subjectId وlevelId المعادين دون تغيير إلى find_booking_tutors بدل طلب اختيار مستوى. تابع باستخدام الأدوات المدرجة والمعرّفات المعادة فقط. لا تقل إن الإجراء غير متاح إلا عندما تكون أداة الإجراء المطلوبة غائبة بعد معرفة حالة الحساب. غياب أدوات التحقق أثناء المكالمة لا يمنع متابعة متصل تم التحقق منه مسبقًا؛ إذا كانت check_subject_eligibility مدرجة فاستدعها مباشرة. قدّم ردًا موجزًا واحدًا في كل دور ولا تكرر عرض التواصل مع الفريق.',
  }[locale];
}

function requestsProtectedBookingOrVerification(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const explicitVerification =
    /\bverify\b.*\b(member|account)\b|\b(member|account)\b.*\bverify\b/u.test(
      normalized,
    ) ||
    /\bv[ée]rif(?:ier|ication)\b.*\b(?:membre|compte|identifiant)\b/u.test(
      normalized,
    ) ||
    /(?:تحقق|تأكد).*(?:العضوية|الحساب|رقم العضو)/u.test(normalized);
  const bookingAction =
    /\b(book|booking|reserve|reservation)\b/u.test(normalized) ||
    /\b(r[ée]server|r[ée]servation)\b/u.test(normalized) ||
    /(?:احجز|حجز|الحجز)/u.test(normalized);
  const bookingObject =
    /\b(session|course|lesson|class|tutor|teacher|availability)\b/u.test(
      normalized,
    ) ||
    /\b(s[ée]ance|cours|le[çc]on|classe|tuteur|professeur|disponibilit[ée])\b/u.test(
      normalized,
    ) ||
    /(?:حصة|دورة|درس|مادة|معلم|مدرس|موعد|توافر)/u.test(normalized);
  const eligibility =
    /\b(eligible|eligibility)\b/u.test(normalized) ||
    /\b[ée]ligib(?:le|ilit[ée])\b/u.test(normalized) ||
    /(?:مؤهل|الأهلية|اهلية)/u.test(normalized);
  return (
    explicitVerification || eligibility || (bookingAction && bookingObject)
  );
}

function requestsNamedCourseAction(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const namesEnglishCourse =
    /\bfor\s+(?!(?:a|an|the|one|any)\s+(?:course|class|lesson)\b)[\p{L}\p{N}][\p{L}\p{N}&'’-]*(?:\s+[\p{L}\p{N}&'’-]+){0,5}\s+(?:course|class|lesson)\b/u.test(
      normalized,
    ) ||
    /\b(?:course|class|lesson)\s+(?:called|named|about|on|in)\s+[\p{L}\p{N}]/u.test(
      normalized,
    ) ||
    /\b(?:take|book|study|join)\s+(?:a|an|the)?\s*[\p{L}\p{N}][\p{L}\p{N}&'â€™-]*(?:\s+[\p{L}\p{N}&'â€™-]+){0,5}\s+(?:course|class|lesson|subject)\b/u.test(
      normalized,
    );
  const namesFrenchCourse =
    /\b(?:cours|classe|leçon)\s+(?:de|d['’]|sur|appelé|nommé)\s+[\p{L}\p{N}]/u.test(
      normalized,
    );
  const namesArabicCourse =
    /(?:دورة|مادة|حصة)\s+(?:في|عن|حول)?\s*[\p{L}\p{N}]/u.test(normalized);
  const asksBookingOrEligibility =
    /\b(book|booking|reserve|reservation)\b/u.test(normalized) ||
    /\b(r[ée]server|r[ée]servation)\b/u.test(normalized) ||
    /(?:احجز|حجز|الحجز)/u.test(normalized) ||
    /\b(eligible|eligibility)\b/u.test(normalized) ||
    /\b[ée]ligib(?:le|ilit[ée])\b/u.test(normalized) ||
    /(?:مؤهل|الأهلية|اهلية)/u.test(normalized);

  return (
    asksBookingOrEligibility &&
    (namesEnglishCourse || namesFrenchCourse || namesArabicCourse)
  );
}

function requestsCourseBooking(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  return (
    /\b(book|booking|reserve|reservation)\b/u.test(normalized) ||
    /\b(r[ée]server|r[ée]servation)\b/u.test(normalized) ||
    /(?:احجز|حجز|الحجز)/u.test(normalized)
  );
}

function requestsCourseCancellation(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  return (
    /\b(cancel|cancellation|cancelled|canceled)\b/u.test(normalized) ||
    /\b(annuler|annulation|annulez)\b/u.test(normalized) ||
    /(?:إلغاء|الغاء|ألغي|الغي|إلغائها|الغائها)/u.test(normalized)
  );
}

function requestsEligibility(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  return (
    /\b(eligible|eligibility|qualify|qualified)\b/u.test(normalized) ||
    /\b[ée]ligib(?:le|ilité)|admissible\b/u.test(normalized) ||
    /(?:مؤهل|الأهلية|اهلية)/u.test(normalized)
  );
}

function requestsTutorCalendar(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const asksCalendar =
    /\b(availability|calendar|available times?|open slots?|(?:one|any|all|some) of (?:them|these tutors) (?:is|are) available)\b/u.test(
      normalized,
    ) ||
    /\b(disponibilit[ée]s?|calendrier|créneaux?)\b/u.test(normalized) ||
    /(?:توفر|توافر|مواعيد|مواقيت|المواعيد|المواقيت|جدول|توقيت|التوقيت|وقت|الوقت|أوقات|اوقات|الأوقات)/u.test(
      normalized,
    );
  const explicitlyNamesCourse =
    /\b(course|class|lesson|subject)\b/u.test(normalized) ||
    /\b(cours|classe|leçon|matière)\b/u.test(normalized) ||
    /(?:دورة|مادة|حصة|درس)/u.test(normalized);
  return asksCalendar && !explicitlyNamesCourse;
}

function requestsEstablishedTutorCalendar(
  value: string,
  establishedTutorCount: number,
): boolean {
  if (establishedTutorCount === 0) return false;
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  return (
    /(?:التوقيت|التواقيت|المواعيد|المواقيت|الأوقات|اوقات|الوقت).*(?:المتاح|المتاحة|عندو|عندك|إلو|إله|إليه|إلي|إليك|له|لهذا|لهذه)/u.test(
      normalized,
    ) ||
    /(?:شو|ما|ايش|أي|وين)\s*(?:التوقيت|المواعيد|المواقيت|الأوقات).*(?:متاح|متاحة|إلو|إله|إليه|له)/u.test(
      normalized,
    )
  );
}

function requestsLaterTutorDates(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  return (
    /\b(more|other|next|later)\b.*\b(availability|available times?|calendar|dates?|slots?|times?)\b/u.test(
      normalized,
    ) ||
    /(?:المواعيد|المواقيت|الأوقات|التواريخ).*(?:الأخرى|التانية|الثانية|الثانية|التالية|اللاحقة|الجاي)\b/u.test(
      normalized,
    ) ||
    /(?:مواعيد|مواقيت|أوقات|تواريخ).*(?:تانية|ثانية|أخرى|لاحقة|تالية)\b/u.test(
      normalized,
    ) ||
    /(?:غير|بدون).*(?:الأحد|اليوم|التاريخ|الموعد)/u.test(normalized) ||
    /(?:يوم|تاريخ|موعد).*(?:ثاني|آخر|غيره|تالي|لاحق)/u.test(normalized) ||
    /(?:فكتر|فكرة|شو في|وش فيه|ايش فيه).*(?:المواعيد|مواعيد|الأوقات|اوقات)/u.test(
      normalized,
    )
  );
}

function isTutorDatesAffirmation(value: string): boolean {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim();
  return /^(?:أذكر|اذكر|أذكار|اذكار|نعم|ايه|إيه|أكيد|اكيد|حلو|تمام|يلا|لو سمحت|ابغى|بدي)$/u.test(
    normalized,
  );
}

function requestsTutorProfileSearch(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const mentionsTutor =
    /\b(tutors?|teachers?|instructors?)\b/u.test(normalized) ||
    /\b(tuteurs?|professeurs?|enseignants?)\b/u.test(normalized) ||
    /(?:معلم|معلمين|مدرس|مدرسين|أستاذ|استاذ|أساتذة)/u.test(normalized);
  const asksDirectory =
    /\b(who|what|which|find|list|show|available|teach|teaches|teaching|provide|provides)\b/u.test(
      normalized,
    ) ||
    /\b(qui|quel|quels|quelle|quelles|trouver|liste|enseigne|enseignent)\b/u.test(
      normalized,
    ) ||
    /(?:من|مين|ما|أي|اعرض|قائمة|يدرّس|يدرس|يقدم)/u.test(normalized);
  const asksWhoTeaches =
    /\bwho\b.*\bteach(?:es|ing)?\b/u.test(normalized) ||
    /(?:مين|من)\s+(?:اللي\s+)?(?:بيعلم|يعلم|يدرس|يدرّس|يعطي)/u.test(normalized);
  return (
    (asksWhoTeaches || (mentionsTutor && asksDirectory)) &&
    !requestsTutorCalendar(value)
  );
}

function requestsBundleRecommendation(value: string): boolean {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const mentionsBundle =
    /\b(bundles?|packages?|plans?|abundance|buttons?)\b/u.test(normalized) ||
    /\b(forfaits?|packs?|formules?)\b/u.test(normalized) ||
    /(?:باقة|باقات|حزمة|حزم)/u.test(normalized);
  const asksRecommendation =
    /\b(recommend|recommended|suggest|unlock|unblock|cover|covers|need|buy|which|what)\b/u.test(
      normalized,
    ) ||
    /\b(recommande|recommandes|conseille|débloque|couvre|quel|quelle)\b/u.test(
      normalized,
    ) ||
    /(?:أنصح|تنصح|اقترح|يفتح|يغطي|أي|ما هي)/u.test(normalized);
  return mentionsBundle && asksRecommendation;
}

function resolveBundleLevelReply(
  value: string,
  levels: string[],
): { anyLevel: true } | { levelName: string } | undefined {
  const normalized = value.normalize('NFKC').toLocaleLowerCase().trim();
  if (
    /\b(any|all|either|no preference|does not matter|doesn't matter)\b/u.test(
      normalized,
    ) ||
    /\b(n'importe lequel|tous|toutes|sans préférence)\b/u.test(normalized) ||
    /(?:أي|الكل|كل المستويات|لا فرق)/u.test(normalized)
  ) {
    return { anyLevel: true };
  }
  const match = levels.find((level) => {
    const normalizedLevel = level.normalize('NFKC').toLocaleLowerCase();
    return (
      normalized === normalizedLevel ||
      normalized.includes(normalizedLevel) ||
      normalizedLevel.includes(normalized)
    );
  });
  return match ? { levelName: match } : undefined;
}

function isAcknowledgementOnly(value: string): boolean {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return /^(okay|ok|alright|all right|got it|thanks|thank you|d accord|accord|merci|حسنا|حسنًا|تمام|شكرا|شكرًا)$/.test(
    normalized,
  );
}

function isExplicitBookingConfirmation(value: string): boolean {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return /^(yes|yes please|yes book it|yes proceed|confirm|confirmed|confirmed proceed|please proceed|oui|oui merci|oui confirmez|je confirme|نعم|نعم احجز|نعم احجزه|أكيد|اكيد|موافق|أوافق)$/.test(
    normalized,
  );
}

function isExplicitCancellationConfirmation(value: string): boolean {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return /^(yes|yes please|yes confirm|yes confirmed|yes cancel it|yes confirm cancellation|confirm|confirm cancellation|confirmed|confirmed cancel it|confirmed cancellation|cancel it|oui|oui confirmez|oui annulez|je confirme|نعم|نعم أكد|نعم اكد|نعم ألغها|نعم الغها|أكد الإلغاء|اكد الالغاء|أكيد|اكيد|أوافق|اوافق)$/.test(
    normalized,
  );
}

function requestedPersonalAccountTool(
  value: string,
): 'get_my_wallet' | 'get_my_bootcamps' | undefined {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const asksAboutWallet =
    /\b(wallet|wallet balance|credits? left|remaining credits|my credits)\b/u.test(
      normalized,
    ) && /\b(my|mine|check|show|see|balance|credits?)\b/u.test(normalized);
  if (
    asksAboutWallet ||
    (/(?:محفظة|محفظتي|رصيد|أرصدة|ارصدة)/u.test(normalized) &&
      /(?:لي|عندي|حسابي|تحقق|افحص|اعرض)/u.test(normalized)) ||
    (/\bportefeuille\b/u.test(normalized) &&
      /\b(mon|ma|mes|solde|consulter|vérifier|verifier)\b/u.test(normalized))
  ) {
    return 'get_my_wallet';
  }

  const asksAboutPersonalBootcamps =
    /\bbootcamps?\b/u.test(normalized) &&
    /\b(my|mine|i|me|enrolled|enrollment|joined|registered|have)\b/u.test(
      normalized,
    );
  if (
    asksAboutPersonalBootcamps ||
    (/(?:معسكر|معسكراتي)/u.test(normalized) &&
      /(?:مسجل|اشتركت|لدي|عندي)/u.test(normalized)) ||
    (/\bbootcamps?\b/u.test(normalized) &&
      /\b(mes|mon|inscrit|inscription)\b/u.test(normalized))
  ) {
    return 'get_my_bootcamps';
  }
  return undefined;
}

function firstCallerResponseInstructions(
  locale: ToolContext['locale'],
): string {
  return {
    en: 'Do not greet first; use only tools listed for this call. For descriptive TutWithUs questions other than public catalog or named-course bundle recommendations, if search_knowledge is listed, say one brief, professional progress sentence tied to the exact question, call it, then answer every part using only the returned details and conditions. Preserve names, numbers, and negation; never guess. If search_knowledge is absent, briefly say the information is unavailable. Treat booking, availability, and account requests as actions; do not call search_knowledge. For a general question about wallet course access with no named course, verify once if needed and call get_my_wallet with includeCourseAccessLevels=true; report positiveCreditLevels, note if the list is incomplete, and invite the caller to name a course for check_subject_eligibility. For a named-course eligibility or booking request, verify once if needed, then call check_subject_eligibility once with the course name. Do not call get_subjects or get_my_wallet separately for that flow. For wallet-only questions, use get_my_wallet without includeCourseAccessLevels. If a protected tool is hidden, verify only when both verification tools are listed, then use only tools listed for the verified role. Say an action is unavailable only if its action tool is absent and no listed verification workflow can make it available. If the action tool is listed, use it directly regardless of whether in-call verification tools are listed. Follow the booking instructions and report only returned slots. Never say any internal ID, even partially. After the caller selects a slot, ask whether they want to add a brief session note. If they have no note, use the subject and tutor names in the default description. Prepare the exact description and ask for confirmation exactly once. On the next explicit yes, call book_course directly. Do not claim success until the tool confirms the booking. Be warm, direct, and brief; ask a question only when needed. Never request a phone number, repeat or store the member ID, or claim success without tool confirmation.',
    fr: 'Ne commencez pas par une salutation et utilisez uniquement les outils présents pour cet appel. Pour une question informative sur TutWithUs, si search_knowledge est présent, dites une phrase d’attente brève et liée à la question, appelez-le, puis répondez à toutes les parties uniquement à partir des détails et conditions renvoyés. Préservez les noms, les nombres et la négation ; ne devinez jamais. S’il manque, dites brièvement que l’information n’est pas disponible. Traitez les demandes de réservation, de disponibilité ou de compte comme des actions et n’appelez pas search_knowledge. Pour une question générale, sans cours précis, sur les cours couverts par le portefeuille, vérifiez si nécessaire, appelez get_my_wallet avec includeCourseAccessLevels=true, indiquez positiveCreditLevels, signalez si la liste est partielle et invitez la personne à nommer un cours pour check_subject_eligibility. Pour l’éligibilité ou la réservation d’un cours précis, vérifiez une seule fois si nécessaire, puis appelez une seule fois check_subject_eligibility avec le nom du cours. N’appelez pas séparément get_subjects ni get_my_wallet pour ce parcours. Pour une demande portant uniquement sur le portefeuille, utilisez get_my_wallet sans includeCourseAccessLevels. Si un outil protégé est masqué, vérifiez le compte seulement si les deux outils de vérification sont présents, puis utilisez uniquement les outils du rôle confirmé. Dites qu’une action est indisponible uniquement si son outil d’action est absent et qu’aucun parcours de vérification présent ne peut le rendre disponible. Si l’outil d’action est présent, utilisez-le directement, même si les outils de vérification pendant l’appel ne sont pas présents. Suivez les consignes de réservation, indiquez uniquement les créneaux renvoyés et appelez book_course après confirmation explicite d’un créneau exact. Soyez chaleureux, direct et bref ; posez une question seulement si elle est nécessaire. Ne demandez jamais de numéro de téléphone, ne répétez ni ne conservez l’identifiant membre et ne prétendez pas avoir réussi sans confirmation de l’outil.',
    'ar-SA':
      'لا تبدأ بتحية واستخدم الأدوات المدرجة لهذه المكالمة فقط. للسؤال المعلوماتي عن TutWithUs، إذا كانت search_knowledge مدرجة، قل جملة انتظار قصيرة ومهنية مرتبطة بالسؤال ثم استدعها، وأجب عن جميع الأجزاء من التفاصيل والشروط المعادة فقط. حافظ على الأسماء والأرقام والنفي ولا تخمّن. إذا لم تكن مدرجة، وضّح باختصار أن المعلومة غير متاحة. تعامل مع الحجز أو التوافر أو إجراء الحساب كطلب إجراء ولا تستدعِ search_knowledge. إذا سأل المتصل بشكل عام عن الدورات التي تتيحها محفظته دون تسمية دورة، فتحقّق عند الحاجة ثم استدعِ get_my_wallet مع includeCourseAccessLevels=true، واذكر positiveCreditLevels مع توضيح إن كانت القائمة جزئية، واطلب منه تسمية دورة لفحصها عبر check_subject_eligibility. لأهلية دورة محددة أو حجزها، تحقّق مرة واحدة عند الحاجة ثم استدعِ check_subject_eligibility مرة واحدة مع اسم الدورة. لا تستدعِ get_subjects أو get_my_wallet منفصلتين لهذا المسار. لطلب المحفظة فقط، استخدم get_my_wallet من دون includeCourseAccessLevels. إذا كانت أداة محمية مخفية، فتحقق فقط إذا كانت أداتا التحقق مدرجتين، ثم استخدم أدوات الدور الموثّق المدرجة فقط. لا تقل إن الإجراء غير متاح إلا إذا كانت أداة الإجراء غائبة ولا يوجد مسار تحقق مدرج يمكنه إتاحتها. إذا كانت أداة الإجراء مدرجة، فاستدعها مباشرة حتى إن لم تكن أدوات التحقق أثناء المكالمة مدرجة. اتبع تعليمات الحجز، واذكر المواعيد المعادة فقط، ولا تستدعِ book_course إلا بعد موافقة صريحة على موعد محدد. كن ودودًا ومباشرًا وموجزًا، ولا تسأل إلا عند الحاجة. لا تطلب رقم الهاتف ولا تكرر رقم العضوية أو تحفظه، ولا تدّعِ النجاح دون تأكيد الأداة.',
  }[locale];
}

function personalWalletPriorityInstructions(
  locale: ToolContext['locale'],
): string {
  return {
    en: 'Highest-priority wallet intent: If the caller asks what bundle or bundles they personally have or own, which bundle they bought, how many credits they have left, or which courses their wallet generally gives access to without naming a course, treat it as a personal account lookup, not a factual question. Do not call search_knowledge. If get_my_wallet is not listed yet, it is intentionally hidden until verification; do not say the lookup is unavailable. If request_member_id and verify_member_id are listed, call request_member_id without speaking the ID question yourself; its follow-up asks once. After the caller answers, call verify_member_id, then call get_my_wallet if it becomes listed; pass includeCourseAccessLevels=true only for the general course-access request. For general course access, report positiveCreditLevels and note if the list is incomplete; do not imply every course at those levels is eligible. Invite the caller to name a course for check_subject_eligibility. General descriptive bundle questions may use knowledge search; recommendations or price options for a named course use recommend_course_bundle.',
    fr: 'Priorité absolue aux demandes de portefeuille : si la personne demande quel(s) forfait(s) elle possède, lequel elle a acheté, combien de crédits il lui reste ou à quels cours son portefeuille donne accès sans nommer de cours, traitez cela comme une consultation personnelle du compte, pas comme une question factuelle. N’appelez pas search_knowledge. Si get_my_wallet n’est pas encore listé, il est volontairement masqué jusqu’à la vérification ; ne dites pas que la consultation est indisponible. Si request_member_id et verify_member_id sont présents, appelez request_member_id sans poser vous-même la question sur l’identifiant ; son suivi la pose une seule fois. Après la réponse, appelez verify_member_id, puis get_my_wallet s’il est listé ; définissez includeCourseAccessLevels=true uniquement pour la demande générale d’accès aux cours. Pour l’accès général aux cours, indiquez positiveCreditLevels, précisez si la liste est partielle et n’affirmez pas que chaque cours de ces niveaux est éligible. Invitez la personne à nommer un cours pour check_subject_eligibility. Les questions générales sur les forfaits proposés ou leurs prix peuvent utiliser la recherche factuelle.',
    'ar-SA':
      'أولوية قصوى لاستعلام المحفظة: إذا سأل المتصل عن الباقة التي يملكها أو اشتراها، أو عن الأرصدة المتبقية، أو عن الدورات التي تتيحها محفظته دون تسمية دورة، فتعامل مع ذلك كاستعلام شخصي عن الحساب وليس كسؤال معلوماتي عام. لا تستدعِ search_knowledge. إذا لم تكن get_my_wallet مدرجة بعد، فهي مخفية عمدًا حتى التحقق؛ فلا تقل إن الاستعلام غير متاح. إذا كانت request_member_id وverify_member_id مدرجتين، فاستدعِ request_member_id من دون أن تسأل عن الرقم بنفسك؛ فتعليمات المتابعة ستطلبه مرة واحدة. بعد إجابة المتصل، استدعِ verify_member_id ثم get_my_wallet إذا أصبحت مدرجة؛ واضبط includeCourseAccessLevels=true لطلب الوصول العام للدورات فقط. للوصول العام إلى الدورات، اذكر positiveCreditLevels ووضّح إن كانت القائمة جزئية ولا تقل إن كل دورة ضمن هذه المستويات مؤهلة. اطلب اسم دورة محددة لفحصها عبر check_subject_eligibility. يمكن استخدام البحث المعلوماتي للأسئلة العامة عن الباقات المتاحة أو أسعارها.',
  }[locale];
}

function roleToolVisibilityInstructions(locale: ToolContext['locale']): string {
  return {
    en: 'Role-based tools are intentionally hidden until verification succeeds. Public level/subject selection tools do not require verification. If get_my_wallet or another role-protected action tool is listed, the caller is already verified for this call; use listed tools directly and do not request or verify the member ID again. If a requested protected tool is hidden and request_member_id plus verify_member_id are listed, request the ID once and verify it. For a personal wallet or general wallet-course-access request with no named course, get_my_wallet is intentionally hidden before verification; do not say the lookup is unavailable. After verification, use only tools listed for the verified role. For general wallet-course access, pass includeCourseAccessLevels=true.',
    fr: 'Les outils associés à un rôle sont masqués jusqu’à la réussite de la vérification. La sélection publique des niveaux et matières ne nécessite pas de vérification. Si get_my_wallet ou un autre outil protégé par rôle est présent, la personne est déjà vérifiée pour cet appel ; utilisez les outils présents sans redemander ni revérifier l’identifiant. Si l’outil protégé demandé est masqué et que request_member_id et verify_member_id sont présents, demandez l’identifiant une seule fois et vérifiez-le. Pour une consultation personnelle du portefeuille ou une question générale sur les cours couverts par le portefeuille sans cours nommé, get_my_wallet est volontairement masqué avant la vérification ; ne dites pas que la consultation est indisponible. Après vérification, utilisez uniquement les outils présents pour le rôle confirmé. Pour l’accès général aux cours du portefeuille, définissez includeCourseAccessLevels=true.',
    'ar-SA':
      'تُخفى الأدوات الخاصة بكل دور حتى ينجح التحقق. لا يتطلب اختيار المستوى والمادة العام التحقق. إذا كانت get_my_wallet أو أداة إجراء محمية حسب الدور مدرجة، فهذا يعني أن التحقق نجح لهذه المكالمة؛ استخدم الأدوات المدرجة ولا تطلب رقم العضوية أو تتحقق منه مرة أخرى. إذا كانت أداة الإجراء المطلوبة مخفية وكانت request_member_id وverify_member_id مدرجتين، فاطلب الرقم مرة واحدة وتحقق منه. لاستعلام المحفظة الشخصية أو السؤال العام عن الدورات التي تغطيها المحفظة دون تسمية دورة، تُخفى get_my_wallet عمدًا قبل التحقق؛ فلا تقل إن الاستعلام غير متاح. بعد التحقق، استخدم أدوات الدور الموثّق المدرجة فقط. للوصول العام إلى الدورات من المحفظة، اضبط includeCourseAccessLevels=true.',
  }[locale];
}

function catalogFollowUpInstructions(locale: ToolContext['locale']): string {
  return {
    en: 'Catalog exception: for questions about offered courses/subjects or whether a named course is listed, call get_subjects if the tool is available. Do not use search_knowledge or ask for verification; report returned labels only. If unavailable, do not guess or infer tutor/time availability or bundle eligibility. This overrides generic factual-question guidance.',
    fr: 'Exception catalogue : pour les questions sur les cours/matières proposés ou la présence d’un cours précis, appelez get_subjects si l’outil est disponible. N’utilisez pas search_knowledge et ne demandez pas de vérification ; donnez uniquement les libellés renvoyés. Si la liste est indisponible, ne devinez pas et ne déduisez ni disponibilité ni éligibilité. Cette exception prévaut sur la règle générale.',
    'ar-SA':
      'استثناء القائمة: عند السؤال عن الدورات أو المواد المقدمة أو وجود دورة محددة، استدعِ get_subjects إذا كانت الأداة متاحة. لا تستخدم search_knowledge ولا تطلب التحقق؛ اذكر الأسماء المعادة فقط. إذا تعذرت القائمة، فلا تخمّن ولا تستنتج التوفر أو الأهلية. يتقدم هذا الاستثناء على القاعدة العامة.',
  }[locale];
}

export const FLAG_SESSION_TAMPERED = 'session_tampered';

// System messages that tell the agent the result of the account check. The
// server writes them; the caller cannot, so the agent can trust them.
const ACCOUNT_NOTICES: Record<AccountCheckOutcome, string> = {
  verified:
    'ACCOUNT CHECK RESULT: verified. Do not give a separate verification confirmation. The server has refreshed the tools for the verified role. For a pending general question about courses their wallet gives access to with no named course, call get_my_wallet with includeCourseAccessLevels=true and report positiveCreditLevels, noting if the list is incomplete and that levels do not confirm eligibility for every course; invite the caller to name a course for check_subject_eligibility. For pending eligibility or booking of a named course, call check_subject_eligibility once with the original course name; do not call get_subjects or get_my_wallet separately. For a wallet-only request, call get_my_wallet without includeCourseAccessLevels. Continue using only matching tools now listed, and do not ask the caller to repeat or name the request. The access token and role are server-only; never reveal or describe them.',
  not_registered:
    'ACCOUNT CHECK RESULT: not verified. Say the member ID may be incorrect or the caller may need to create an account, and ask them to check the member ID in their TutWithUs profile. Do not reveal whether the call-start phone matched, repeat the submitted ID, or perform account actions. You can still answer general questions.',
  unavailable:
    'ACCOUNT CHECK RESULT: unavailable. The account check could not be completed right now. Do not perform account actions. Explain that the action is temporarily unavailable and ask the caller to try again later. You can still answer general questions.',
};
const ACCOUNT_TOOLS_UNAVAILABLE_NOTICE: Record<ToolContext['locale'], string> =
  {
    en: 'ACCOUNT ACCESS RESULT: The member ID was accepted, but secure account tools could not be activated. Do not repeat the ID, claim wallet details, or perform account actions. Explain that account details are temporarily unavailable.',
    fr: 'RÉSULTAT DU COMPTE : l’identifiant membre a été accepté, mais les outils sécurisés du compte n’ont pas pu être activés. Ne répétez pas l’identifiant, n’inventez aucune information de portefeuille et n’effectuez aucune action sur le compte. Expliquez que les informations sont temporairement indisponibles.',
    'ar-SA':
      'نتيجة الوصول إلى الحساب: تم قبول رقم العضوية، لكن تعذر تفعيل أدوات الحساب الآمنة. لا تكرر الرقم ولا تخمّن تفاصيل المحفظة ولا تنفذ إجراءات على الحساب. وضّح أن تفاصيل الحساب غير متاحة مؤقتًا.',
  };
const ACCOUNT_TOOLS_UNAVAILABLE_FOLLOW_UP: Record<
  ToolContext['locale'],
  string
> = {
  en: 'Tell the caller once that you cannot access their account details right now and ask them to try again later. Do not mention tools or repeat the member ID.',
  fr: 'Dites une seule fois que vous ne pouvez pas accéder aux informations du compte pour le moment et invitez la personne à réessayer plus tard. Ne mentionnez pas les outils et ne répétez pas l’identifiant membre.',
  'ar-SA':
    'أخبر المتصل مرة واحدة أنك لا تستطيع الوصول إلى تفاصيل الحساب حاليًا واطلب منه المحاولة لاحقًا. لا تذكر الأدوات ولا تكرر رقم العضوية.',
};

export type TranscriptTurn = {
  eventId: string;
  speaker: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
};

export type CallEnd = {
  reason: string;
  flags: string[];
  usage: { inputTokens: number; outputTokens: number };
};

// What the call was created with. Used to detect a client changing the session.
export type SessionExpectation = {
  instructions: string;
  toolNames: string[];
  outputModalities: string[];
};

export type SessionControllerDeps = {
  sessionId: string;
  sideband: RealtimeSideband;
  tools: ToolGateway;
  toolContext: ToolContext;
  initialAccount?: {
    serverAccessToken: string;
    serverRole: string;
  };
  startedAt: Date;
  recordExpiresAt: Date;
  expected: SessionExpectation;
  limits: { maxCallSec: number; idleTimeoutSec: number };
  // How long to keep the call open after the goodbye so the caller hears it.
  goodbyePlaybackGraceMs: number;
  logger: Logger;
  hooks: {
    recordTranscript(turn: TranscriptTurn): Promise<void>;
    hangup(): Promise<void>;
    onEnded(end: CallEnd): Promise<void>;
  };
};

type ToolRun = {
  callId: string;
  name: string;
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

type Ending = {
  reason: string;
  // True until the goodbye response has been created by the model.
  awaitingGoodbye: boolean;
  goodbyeResponseId?: string;
  goodbyeDone: boolean;
};

type SessionSnapshot = {
  instructions?: string;
  tools?: string;
  modalities?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function snapshotSession(session: unknown): SessionSnapshot {
  if (!isRecord(session)) {
    return {};
  }
  const instructions = text(session.instructions);
  return {
    ...(instructions !== undefined
      ? { instructions: instructions.replace(/\s+/g, ' ').trim() }
      : {}),
    ...(Array.isArray(session.tools)
      ? {
          tools: session.tools
            .map((tool) => (isRecord(tool) ? (text(tool.name) ?? '?') : '?'))
            .sort()
            .join(','),
        }
      : {}),
    ...(Array.isArray(session.output_modalities)
      ? { modalities: session.output_modalities.map(String).join(',') }
      : {}),
  };
}

function differingFields(
  expected: SessionSnapshot,
  actual: SessionSnapshot,
): string[] {
  const fields: Array<keyof SessionSnapshot> = [
    'instructions',
    'tools',
    'modalities',
  ];
  // A field the event does not carry is "no information", not a change.
  return fields.filter(
    (field) => actual[field] !== undefined && actual[field] !== expected[field],
  );
}

// Owns one live call from the server side: routes events from the sideband,
// runs tool calls through the gateway, records the transcript, enforces the
// call limits and hangs up when the client tampers with the session.
//
// It has no knowledge of HTTP, MongoDB or the browser; everything external
// arrives through `deps`, so it serves the browser and WhatsApp transports.
export class SessionController {
  private baseline: SessionSnapshot;
  private readonly startedAt: number;
  private lastActivityAt = Date.now();
  private userSpeaking = false;
  private pendingCallerResponse = false;
  private pendingTurnRoute: TurnRoute = { kind: 'none' };
  private readonly conversation = new ConversationContext();
  private requestNextTutorDates = false;
  private firstCallerResponse = true;
  private readonly processedCallerTranscripts = new Set<string>();
  private readonly activeResponses = new Set<string>();
  private readonly toolRoutingResponseIds = new Set<string>();
  // Set synchronously when response.create is sent. The provider confirms it
  // later with response.created, so activeResponses alone leaves a brief race
  // where two caller fragments can start overlapping assistant responses.
  private responseCreatePending = false;
  private turnEpoch = 0;
  private readonly responseEpochs = new Map<string, number>();
  private pendingToolResponse = false;
  private pendingToolResponseInstructions: string | undefined;
  private pendingToolResponseAllowsTools = false;
  private pendingToolResponseForcedToolName: string | undefined;
  private pendingSessionUpdate = false;
  private pendingSessionUpdateId: string | undefined;
  private previousSessionTools: string | undefined;
  private readonly toolRuns = new Map<string, Promise<ToolRun>[]>();
  private readonly callCounts = new Map<string, number>();
  private readonly lastToolStatuses = new Map<string, string>();
  private pendingCitations: Citation[] = [];
  // True only after the server matched the caller to a registered customer.
  private customerVerified = false;
  private serverAccessToken: string | undefined;
  private serverRole: string | undefined;
  private sensitiveInputExpected = false;
  private pendingNotices: string[] = [];
  private readonly flags = new Set<string>();
  private readonly usage = { inputTokens: 0, outputTokens: 0 };
  private ending: Ending | undefined;
  private stopped = false;
  private started = false;
  private tickTimer: NodeJS.Timeout | undefined;
  private endTimer: NodeJS.Timeout | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SessionControllerDeps) {
    this.customerVerified = Boolean(deps.initialAccount);
    this.serverAccessToken = deps.initialAccount?.serverAccessToken;
    this.serverRole = deps.initialAccount?.serverRole;
    this.startedAt = deps.startedAt.getTime();
    this.baseline = snapshotSession({
      instructions: deps.expected.instructions,
      tools: deps.expected.toolNames.map((name) => ({ name })),
      output_modalities: deps.expected.outputModalities,
    });
  }

  get sessionId(): string {
    return this.deps.sessionId;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  start(options: { autoRespondToNotices?: boolean } = {}): void {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.updateAvailableTools();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    // Do not keep the process alive just for this timer.
    this.tickTimer.unref();
    if (options.autoRespondToNotices === false) {
      // Browser clients send their greeting immediately after the connection
      // is ready. Seed the hidden caller-status context without racing that
      // greeting with a second response.create event.
      this.sendNoticeItems();
    } else {
      this.flushNotices();
    }
  }

  // Events are handled one at a time, in arrival order.
  handleEvent(event: RealtimeServerEvent): Promise<void> {
    this.queue = this.queue
      .then(() => this.dispatch(event))
      .catch((error: unknown) => {
        this.deps.logger.error(
          {
            source: 'session-controller',
            sessionId: this.deps.sessionId,
            eventType: event.type,
            errorName: errorName(error),
          },
          'Realtime event handling failed',
        );
      });
    return this.queue;
  }

  // Records the result of the caller's account check and lets the agent
  // announce it. The notice waits for any response in progress to finish.
  notifyAccountCheck(
    outcome: AccountCheckOutcome,
    serverAccessToken?: string,
    serverRole?: string,
  ): Promise<void> {
    this.queue = this.queue.then(() => {
      if (this.stopped) {
        return;
      }
      this.customerVerified = outcome === 'verified';
      this.serverAccessToken =
        outcome === 'verified' ? serverAccessToken : undefined;
      this.serverRole = outcome === 'verified' ? serverRole : undefined;
      this.updateAvailableTools();
      this.pendingNotices.push(ACCOUNT_NOTICES[outcome]);
      this.flushNotices();
    });
    return this.queue;
  }

  // The sideband socket closed or failed. Without it tools stop working, so
  // the call is ended rather than left running unsupervised.
  handleSidebandClosed(details?: SidebandCloseInfo): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    this.deps.logger.warn(
      {
        source: 'session-controller',
        sessionId: this.deps.sessionId,
        ...details,
        customerVerified: this.customerVerified,
        serverRole: this.serverRole,
        pendingSessionUpdate: this.pendingSessionUpdate,
        availableToolNames: this.baseline.tools?.split(',').filter(Boolean),
      },
      'Realtime control connection closed',
    );
    return this.stop('connection_closed');
  }

  async stop(reason: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.serverAccessToken = undefined;
    this.serverRole = undefined;
    this.deps.logger.info(
      {
        source: 'session-controller',
        sessionId: this.deps.sessionId,
        reason,
        durationSec: Math.round((Date.now() - this.startedAt) / 1000),
      },
      'Voice session stopping',
    );
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
    }
    if (this.endTimer) {
      clearTimeout(this.endTimer);
    }

    // Hang up first so the caller is disconnected even if later steps fail.
    try {
      await this.deps.hooks.hangup();
    } catch (error) {
      this.deps.logger.warn(
        {
          source: 'session-controller',
          sessionId: this.deps.sessionId,
          errorName: errorName(error),
        },
        'Realtime hang-up failed',
      );
    }
    try {
      this.deps.sideband.close();
    } catch {
      // Already closed.
    }
    try {
      await this.deps.hooks.onEnded({
        reason,
        flags: [...this.flags],
        usage: { ...this.usage },
      });
    } catch (error) {
      this.deps.logger.error(
        {
          source: 'session-controller',
          sessionId: this.deps.sessionId,
          errorName: errorName(error),
        },
        'Ending the voice session failed',
      );
    }
  }

  private async dispatch(event: RealtimeServerEvent): Promise<void> {
    if (this.stopped) {
      return;
    }
    switch (event.type) {
      case 'session.created':
        this.onSessionCreated(event);
        return;
      case 'session.updated':
        await this.onSessionUpdated(event);
        return;
      case 'input_audio_buffer.speech_started':
        this.turnEpoch += 1;
        if (this.responseCreatePending || this.activeResponses.size > 0) {
          // A new caller fragment supersedes the response being generated.
          // Cancel it so the completed fragment receives one fresh answer
          // instead of playing an outdated answer followed by a duplicate.
          this.deps.sideband.send({ type: 'response.cancel' });
        }
        this.pendingToolResponse = false;
        this.pendingToolResponseInstructions = undefined;
        this.pendingToolResponseAllowsTools = false;
        this.pendingToolResponseForcedToolName = undefined;
        this.pendingCitations = [];
        this.userSpeaking = true;
        this.touch();
        return;
      case 'input_audio_buffer.speech_stopped':
        this.userSpeaking = false;
        this.touch();
        this.flushNotices();
        return;
      case 'response.created':
        this.onResponseCreated(event);
        return;
      case 'response.function_call_arguments.done':
        this.onToolCall(event);
        return;
      case 'response.done':
        await this.onResponseDone(event);
        return;
      case 'output_audio_buffer.stopped':
        if (this.ending?.goodbyeDone) {
          await this.stop(this.ending.reason);
        }
        return;
      case 'conversation.item.input_audio_transcription.completed':
        if (this.onCallerTranscript(event)) {
          void this.recordTurn('user', event, 'transcript');
        }
        return;
      case 'conversation.item.input_audio_transcription.failed': {
        const failure = isRecord(event.error) ? event.error : undefined;
        this.deps.logger.warn(
          {
            source: 'session-controller',
            sessionId: this.deps.sessionId,
            providerCode: failure ? text(failure.code) : undefined,
            providerType: failure ? text(failure.type) : undefined,
            providerParam: failure ? text(failure.param) : undefined,
          },
          'Realtime input audio transcription failed',
        );
        return;
      }
      case 'response.output_audio_transcript.done':
        if (
          typeof event.response_id === 'string' &&
          this.toolRoutingResponseIds.has(event.response_id)
        ) {
          return;
        }
        void this.recordTurn('assistant', event, 'transcript');
        return;
      case 'response.output_text.done':
        if (
          typeof event.response_id === 'string' &&
          this.toolRoutingResponseIds.has(event.response_id)
        ) {
          return;
        }
        void this.recordTurn('assistant', event, 'text');
        return;
      case 'error':
        this.deps.logger.warn(
          {
            source: 'session-controller',
            sessionId: this.deps.sessionId,
            providerCode: isRecord(event.error)
              ? text(event.error.code)
              : undefined,
            providerType: isRecord(event.error)
              ? text(event.error.type)
              : undefined,
            providerParam: isRecord(event.error)
              ? text(event.error.param)
              : undefined,
          },
          'Realtime API reported an error',
        );
        if (
          this.pendingSessionUpdate &&
          isRecord(event.error) &&
          text(event.error.event_id) === this.pendingSessionUpdateId
        ) {
          this.onSessionUpdateFailed(event.error);
        }
        return;
      default:
        return;
    }
  }

  // The provider's own view of the session is the baseline for tamper
  // detection, so harmless normalization on its side cannot cause a false alarm.
  private onSessionCreated(event: RealtimeServerEvent): void {
    const created = snapshotSession(event.session);
    const drift = differingFields(this.baseline, created);
    if (drift.length > 0) {
      this.deps.logger.warn(
        {
          source: 'session-controller',
          sessionId: this.deps.sessionId,
          fields: drift,
        },
        'Realtime session differs from the requested configuration',
      );
    }
    this.baseline = { ...this.baseline, ...created };
  }

  private async onSessionUpdated(event: RealtimeServerEvent): Promise<void> {
    const snapshot = snapshotSession(event.session);
    const changed = differingFields(this.baseline, snapshot);
    if (changed.length === 0) {
      if (this.pendingSessionUpdate && snapshot.tools === this.baseline.tools) {
        this.pendingSessionUpdate = false;
        this.pendingSessionUpdateId = undefined;
        this.previousSessionTools = undefined;
        this.deps.logger.info(
          {
            source: 'session-controller',
            sessionId: this.deps.sessionId,
            availableToolNames: this.baseline.tools?.split(',').filter(Boolean),
          },
          'Realtime tool update acknowledged',
        );
        this.flushNotices();
      }
      return;
    }
    this.flags.add(FLAG_SESSION_TAMPERED);
    this.deps.logger.warn(
      {
        source: 'session-controller',
        sessionId: this.deps.sessionId,
        fields: changed,
      },
      'Client changed the realtime session; ending the call',
    );
    await this.stop('tamper_detected');
  }

  private onResponseCreated(event: RealtimeServerEvent): void {
    this.responseCreatePending = false;
    const id = isRecord(event.response) ? text(event.response.id) : undefined;
    if (id) {
      this.activeResponses.add(id);
      const response = isRecord(event.response) ? event.response : undefined;
      const metadata =
        response && isRecord(response.metadata) ? response.metadata : undefined;
      if (metadata?.tutwithus_response_kind === 'tool_routing') {
        this.toolRoutingResponseIds.add(id);
      }
      this.responseEpochs.set(id, this.turnEpoch);
      this.pendingToolResponse = false;
      this.pendingToolResponseInstructions = undefined;
      this.pendingToolResponseAllowsTools = false;
      if (this.ending?.awaitingGoodbye) {
        this.ending.awaitingGoodbye = false;
        this.ending.goodbyeResponseId = id;
      }
    }
    this.touch();
  }

  private onCallerTranscript(event: RealtimeServerEvent): boolean {
    const itemId = text(event.item_id);
    if (
      !itemId ||
      this.processedCallerTranscripts.has(itemId) ||
      !containsRecognizableWords(text(event.transcript))
    ) {
      return false;
    }
    const transcript = text(event.transcript) ?? '';
    this.processedCallerTranscripts.add(itemId);
    this.deps.tools.observeCallerTranscript?.(this.deps.sessionId, transcript);
    if (isExplicitCancellationConfirmation(transcript)) {
      this.deps.tools.confirmPendingCancellation(this.deps.sessionId);
    }
    let bundleLevelName: string | undefined;
    let bundleAnyLevel = false;
    if (this.conversation.pendingBundleLevel) {
      const selection = resolveBundleLevelReply(
        transcript,
        this.conversation.pendingBundleLevel.levels,
      );
      if (selection) {
        this.conversation.rememberSubject(
          this.conversation.pendingBundleLevel.subjectName,
        );
        if ('anyLevel' in selection) {
          bundleAnyLevel = true;
        } else {
          bundleLevelName = selection.levelName;
        }
      }
    }
    const namedCourseAction = requestsNamedCourseAction(transcript);
    const asksLaterTutorDates =
      requestsLaterTutorDates(transcript) ||
      (this.conversation.pendingMoreTutorDates &&
        isTutorDatesAffirmation(transcript));
    const asksEstablishedTutorCalendar = requestsEstablishedTutorCalendar(
      transcript,
      this.conversation.tutors.length,
    );
    this.requestNextTutorDates =
      asksLaterTutorDates && Boolean(this.conversation.lastTutorCalendarDate);
    this.pendingTurnRoute = routeCallerTurn(
      {
        verified: this.customerVerified,
        verificationAvailable:
          this.deps.toolContext.verificationAvailable !== false,
        memberIdAlreadyRequested:
          (this.callCounts.get('request_member_id') ?? 0) > 0,
        bookingStage: this.conversation.bookingStage,
        hasResolvedSubject: Boolean(this.conversation.subjectName),
        tools: new Set(this.baseline.tools?.split(',').filter(Boolean) ?? []),
      },
      {
        cancellationConfirmed: this.deps.tools.hasConfirmedCancellation(
          this.deps.sessionId,
        ),
        cancellationRequested: requestsCourseCancellation(transcript),
        bookingConfirmed: isExplicitBookingConfirmation(transcript),
        protectedActionRequested:
          requestsProtectedBookingOrVerification(transcript),
        tutorCalendarRequested:
          asksLaterTutorDates ||
          asksEstablishedTutorCalendar ||
          requestsTutorCalendar(transcript),
        tutorProfilesRequested: requestsTutorProfileSearch(transcript),
        namedBookingRequested:
          requestsCourseBooking(transcript) && namedCourseAction,
        eligibilityRequested:
          namedCourseAction ||
          Boolean(
            this.conversation.subjectName && requestsEligibility(transcript),
          ),
        accountLookup: requestedPersonalAccountTool(transcript),
        bundleRequested:
          requestsBundleRecommendation(transcript) ||
          Boolean(bundleLevelName) ||
          bundleAnyLevel,
        ...(bundleLevelName ? { bundleLevelName } : {}),
        bundleAnyLevel,
      },
    );
    if (
      isAcknowledgementOnly(transcript) &&
      this.pendingTurnRoute.kind === 'none'
    ) {
      return false;
    }
    this.pendingCallerResponse = true;
    this.flushNotices();
    if (this.sensitiveInputExpected) {
      this.sensitiveInputExpected = false;
      return false;
    }
    return true;
  }

  // Starts the tool immediately but sends its result only after the response
  // that requested it is done: the API allows one active response at a time.
  private onToolCall(event: RealtimeServerEvent): void {
    const responseId = text(event.response_id);
    const callId = text(event.call_id);
    const name = text(event.name);
    if (!responseId || !callId || !name) {
      return;
    }
    if (name === 'search_tutor_profiles') {
      try {
        const args = JSON.parse(text(event.arguments) ?? '{}') as {
          subjectName?: unknown;
        };
        if (typeof args.subjectName === 'string' && args.subjectName.trim()) {
          this.conversation.rememberSubject(args.subjectName);
        }
      } catch {
        // Invalid arguments are handled by the tool gateway.
      }
    }
    if (name === 'check_tutor_calendar') {
      try {
        const args = JSON.parse(text(event.arguments) ?? '{}') as
          Record<string, unknown> | undefined;
        if (
          args &&
          typeof args === 'object' &&
          this.conversation.tutors.length === 1
        ) {
          const tutor = this.conversation.tutors[0]!;
          args.tutorId = tutor.id;
          args.tutorName = tutor.fullName;
          delete args.tutors;
          event = { ...event, arguments: JSON.stringify(args) };
        }
        if (
          this.requestNextTutorDates &&
          args &&
          typeof args === 'object' &&
          this.conversation.lastTutorCalendarDate
        ) {
          const [year, month, day] = this.conversation.lastTutorCalendarDate
            .split('-')
            .map(Number);
          const nextDate = new Date(Date.UTC(year!, month! - 1, day! + 1))
            .toISOString()
            .slice(0, 10);
          args.fromDate = nextDate;
          event = { ...event, arguments: JSON.stringify(args) };
        }
      } catch {
        // Invalid arguments are handled by the tool gateway.
      }
      this.requestNextTutorDates = false;
    }
    const execution = this.deps.tools.execute(
      {
        context: this.deps.toolContext,
        callCounts: this.callCounts,
        lastToolStatuses: this.lastToolStatuses,
        recordExpiresAt: this.deps.recordExpiresAt,
        customerVerified: this.customerVerified,
        ...(this.serverAccessToken
          ? { serverAccessToken: this.serverAccessToken }
          : {}),
        ...(this.serverAccessToken ? { serverRole: this.serverRole } : {}),
      },
      name,
      text(event.arguments) ?? '{}',
    );
    const run = execution.then((result): ToolRun => ({
      callId,
      name,
      ...result,
    }));
    const runs = this.toolRuns.get(responseId) ?? [];
    runs.push(run);
    this.toolRuns.set(responseId, runs);
  }

  private async onResponseDone(event: RealtimeServerEvent): Promise<void> {
    const response = isRecord(event.response) ? event.response : {};
    const id = text(response.id);
    const epoch = id
      ? (this.responseEpochs.get(id) ?? this.turnEpoch)
      : this.turnEpoch;
    if (id) this.responseEpochs.delete(id);
    this.touch();
    if (id) {
      this.activeResponses.delete(id);
      this.toolRoutingResponseIds.delete(id);
    }
    if (isRecord(response.usage)) {
      const { input_tokens, output_tokens } = response.usage;
      if (typeof input_tokens === 'number') {
        this.usage.inputTokens += input_tokens;
      }
      if (typeof output_tokens === 'number') {
        this.usage.outputTokens += output_tokens;
      }
    }

    if (id && this.ending?.goodbyeResponseId === id) {
      this.ending.goodbyeDone = true;
      // For audio, `output_audio_buffer.stopped` ends the call as soon as the
      // caller has heard the goodbye; this timer is the fallback.
      this.armEndTimer(this.deps.goodbyePlaybackGraceMs);
      return;
    }

    const runs = id ? this.toolRuns.get(id) : undefined;
    if (!id || !runs) {
      this.flushNotices();
      return;
    }
    // Never await external work inside the event queue. Speech/cancellation
    // events must remain responsive while a tool or database is slow.
    void Promise.all(runs).then((results) => {
      this.queue = this.queue
        .then(() => {
          this.toolRuns.delete(id);
          this.deliverToolResults(results, epoch, text(response.status));
        })
        .catch((error: unknown) => {
          this.deps.logger.error(
            { errorName: errorName(error) },
            'Tool result delivery failed',
          );
        });
    });
  }

  private deliverToolResults(
    results: ToolRun[],
    epoch: number,
    status?: string,
  ): void {
    if (this.stopped || this.ending) {
      return;
    }
    for (const result of results) {
      let status: string | undefined;
      let parsedOutput:
        | {
            status?: unknown;
            subjectName?: unknown;
            profiles?: unknown;
            levels?: unknown;
            date?: unknown;
            laterDatesAvailable?: unknown;
          }
        | undefined;
      try {
        parsedOutput = JSON.parse(result.output) as {
          status?: unknown;
          subjectName?: unknown;
          profiles?: unknown;
          levels?: unknown;
          date?: unknown;
          laterDatesAvailable?: unknown;
        };
        status =
          typeof parsedOutput.status === 'string'
            ? parsedOutput.status
            : undefined;
      } catch {
        status = undefined;
      }
      if (
        result.name === 'check_subject_eligibility' &&
        typeof parsedOutput?.subjectName === 'string'
      ) {
        this.conversation.rememberSubject(parsedOutput.subjectName);
      }
      if (
        result.name === 'search_tutor_profiles' &&
        Array.isArray(parsedOutput?.profiles)
      ) {
        this.conversation.rememberTutors(
          parsedOutput.profiles.flatMap((profile) => {
            if (
              typeof profile === 'object' &&
              profile !== null &&
              typeof (profile as { id?: unknown }).id === 'string' &&
              typeof (profile as { fullName?: unknown }).fullName === 'string'
            ) {
              return [
                {
                  id: (profile as { id: string }).id,
                  fullName: (profile as { fullName: string }).fullName,
                },
              ];
            }
            return [];
          }),
        );
      }
      if (
        result.name === 'check_tutor_calendar' &&
        typeof parsedOutput?.date === 'string'
      ) {
        this.conversation.rememberTutorCalendarDate(parsedOutput.date);
        this.conversation.pendingMoreTutorDates =
          parsedOutput.status === 'available' &&
          parsedOutput.laterDatesAvailable === true;
      }
      if (
        result.name === 'recommend_course_bundle' &&
        status === 'level_required' &&
        typeof parsedOutput?.subjectName === 'string' &&
        Array.isArray(parsedOutput.levels)
      ) {
        const levels = parsedOutput.levels.filter(
          (level): level is string =>
            typeof level === 'string' && Boolean(level.trim()),
        );
        this.conversation.requireBundleLevel(parsedOutput.subjectName, levels);
      } else if (
        result.name === 'recommend_course_bundle' &&
        status === 'bundle_options'
      ) {
        this.conversation.clearBundleLevel();
      }
      if (result.name === 'start_course_booking' && status === 'available') {
        this.conversation.bookingStage = 'slots_offered';
      } else if (
        result.name === 'prepare_course_booking' &&
        status === 'awaiting_confirmation'
      ) {
        this.conversation.bookingStage = 'awaiting_confirmation';
      } else if (result.name === 'book_course' && status === 'booked') {
        this.conversation.bookingStage = 'idle';
      }
      if (typeof result.customerVerified === 'boolean') {
        this.customerVerified = result.customerVerified;
        this.serverAccessToken = result.customerVerified
          ? result.serverAccessToken
          : undefined;
        this.serverRole = result.customerVerified
          ? result.serverRole
          : undefined;
      }
    }
    this.updateAvailableTools();
    const currentTurn =
      epoch === this.turnEpoch && status !== 'cancelled' && status !== 'failed';
    if (currentTurn && results.some((result) => result.endCall)) {
      // The model says goodbye in the same turn it calls end_call, so there is
      // nothing left to ask it. Wait for the goodbye to finish playing.
      this.ending = {
        reason: 'assistant_ended',
        awaitingGoodbye: false,
        goodbyeDone: true,
      };
      this.armEndTimer(this.deps.goodbyePlaybackGraceMs);
      return;
    }
    for (const result of results) {
      this.deps.sideband.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: result.callId,
          output: result.output,
        },
      });
    }
    if (currentTurn) {
      this.sensitiveInputExpected = results.some(
        (result) => result.sensitiveInputExpected,
      );
      this.pendingCitations.push(
        ...results.flatMap((result) => result.citations),
      );
      this.pendingToolResponse = true;
      this.pendingToolResponseInstructions = results
        .map((result) => result.followUpInstructions)
        .filter((value): value is string => Boolean(value))
        .join('\n');
      this.pendingToolResponseAllowsTools = results.some(
        (result) => result.allowToolCalls,
      );
    }
    this.flushNotices();
  }

  private updateAvailableTools(): void {
    const allowedStatefulTools = new Set(
      this.conversation.bookingStage === 'idle'
        ? ['start_course_booking']
        : this.conversation.bookingStage === 'slots_offered'
          ? ['start_course_booking', 'prepare_course_booking']
          : this.conversation.bookingStage === 'awaiting_confirmation'
            ? ['start_course_booking', 'prepare_course_booking', 'book_course']
            : [],
    );
    const tools = this.deps.tools
      .realtimeTools({
        customerVerified: this.customerVerified,
        ...(this.deps.toolContext.verificationAvailable !== undefined
          ? {
              verificationAvailable:
                this.deps.toolContext.verificationAvailable,
            }
          : {}),
        ...(this.serverRole ? { serverRole: this.serverRole } : {}),
      })
      .filter(
        (tool) =>
          !STATEFUL_BOOKING_TOOLS.has(tool.name) ||
          allowedStatefulTools.has(tool.name),
      );
    const toolNames = tools
      .map((tool) => tool.name)
      .sort()
      .join(',');
    if (toolNames === this.baseline.tools) {
      return;
    }

    const eventId = randomUUID();
    this.previousSessionTools = this.baseline.tools;
    this.baseline = { ...this.baseline, tools: toolNames };
    this.pendingSessionUpdate = true;
    this.pendingSessionUpdateId = eventId;
    this.deps.logger.info(
      {
        source: 'session-controller',
        sessionId: this.deps.sessionId,
        customerVerified: this.customerVerified,
        serverRole: this.serverRole,
        availableToolNames: toolNames.split(',').filter(Boolean),
      },
      'Refreshing realtime tools for account status',
    );
    this.deps.sideband.send({
      type: 'session.update',
      event_id: eventId,
      session: { type: 'realtime', tools },
    });
  }

  private onSessionUpdateFailed(error: Record<string, unknown>): void {
    this.pendingSessionUpdate = false;
    this.pendingSessionUpdateId = undefined;
    if (this.previousSessionTools !== undefined) {
      this.baseline = { ...this.baseline, tools: this.previousSessionTools };
    }
    this.previousSessionTools = undefined;
    this.customerVerified = false;
    this.serverAccessToken = undefined;
    this.serverRole = undefined;
    this.flags.add('account_tools_unavailable');
    this.pendingNotices = this.pendingNotices.filter(
      (notice) => notice !== ACCOUNT_NOTICES.verified,
    );
    this.pendingNotices.push(
      ACCOUNT_TOOLS_UNAVAILABLE_NOTICE[this.deps.toolContext.locale],
    );
    this.pendingToolResponse = true;
    this.pendingToolResponseInstructions =
      ACCOUNT_TOOLS_UNAVAILABLE_FOLLOW_UP[this.deps.toolContext.locale];
    this.pendingToolResponseAllowsTools = false;
    this.deps.logger.error(
      {
        source: 'session-controller',
        sessionId: this.deps.sessionId,
        providerCode: text(error.code),
        providerType: text(error.type),
        providerParam: text(error.param),
      },
      'Realtime rejected the verified-role tool update',
    );
    this.flushNotices();
  }

  private async recordTurn(
    speaker: 'user' | 'assistant',
    event: RealtimeServerEvent,
    field: 'transcript' | 'text',
  ): Promise<void> {
    const itemId = text(event.item_id);
    const content = text(event[field])?.trim();
    if (!itemId || !content) {
      return;
    }
    this.touch();

    let citations: Citation[] | undefined;
    if (speaker === 'assistant' && this.pendingCitations.length > 0) {
      const unique = new Map(
        this.pendingCitations.map((citation) => [citation.sourceId, citation]),
      );
      citations = [...unique.values()].slice(0, MAX_CITATIONS_PER_TURN);
      this.pendingCitations = [];
    }
    try {
      await this.deps.hooks.recordTranscript({
        eventId: `${speaker}:${itemId}`,
        speaker,
        text: content.slice(0, MAX_TURN_CHARACTERS),
        ...(citations ? { citations } : {}),
      });
    } catch (error) {
      this.deps.logger.error(
        {
          source: 'session-controller',
          sessionId: this.deps.sessionId,
          errorName: errorName(error),
        },
        'Transcript turn could not be stored',
      );
    }
  }

  // Adds waiting notices to the conversation. Returns whether any were sent.
  private sendNoticeItems(): boolean {
    if (this.pendingNotices.length === 0) {
      return false;
    }
    for (const notice of this.pendingNotices) {
      this.deps.sideband.send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [{ type: 'input_text', text: notice }],
        },
      });
    }
    this.pendingNotices = [];
    return true;
  }

  // Sends waiting notices and asks the agent to respond only after active
  // responses, tools, and session updates have finished.
  private flushNotices(): void {
    if (this.stopped || this.ending) {
      return;
    }
    if (
      this.userSpeaking ||
      this.responseCreatePending ||
      this.activeResponses.size > 0 ||
      this.toolRuns.size > 0 ||
      this.pendingSessionUpdate
    ) {
      return;
    }
    const hasNotices = this.sendNoticeItems();
    if (hasNotices || this.pendingToolResponse || this.pendingCallerResponse) {
      const callerResponse = this.pendingCallerResponse;
      const toolResponseInstructions = this.pendingToolResponseInstructions;
      const toolResponseAllowsTools = this.pendingToolResponseAllowsTools;
      const toolResponseForcedToolName = this.pendingToolResponseForcedToolName;
      this.pendingToolResponse = false;
      this.pendingToolResponseInstructions = undefined;
      this.pendingToolResponseAllowsTools = false;
      this.pendingToolResponseForcedToolName = undefined;
      this.pendingCallerResponse = false;
      if (callerResponse) {
        const route = this.pendingTurnRoute;
        this.pendingTurnRoute = { kind: 'none' };
        const forceMemberIdRequest = route.kind === 'request_member_id';
        const forceCourseBookingStart = route.kind === 'start_course_booking';
        const forceCourseEligibilityCheck =
          route.kind === 'check_subject_eligibility';
        const forceBookCourse = route.kind === 'book_course';
        const forceCancelCourse = route.kind === 'cancel_course';
        const forceCancellationLookup =
          route.kind === 'list_courses_for_cancellation';
        const forceTutorProfileLookup = route.kind === 'search_tutor_profiles';
        const forceTutorCalendarLookup = route.kind === 'check_tutor_calendar';
        const forceUnverifiedTutorCalendarNotice =
          route.kind === 'unverified_tutor_calendar';
        const forceAccountLookupTool =
          route.kind === 'account_lookup' ? route.tool : undefined;
        const forceBundleRecommendation =
          route.kind === 'recommend_course_bundle';
        const forcedBundleLevelName =
          route.kind === 'recommend_course_bundle'
            ? route.levelName
            : undefined;
        const forcedBundleAnyLevel =
          route.kind === 'recommend_course_bundle' && route.anyLevel;
        const routeContract = turnResponseContract({
          route,
          locale: this.deps.toolContext.locale,
          ...(this.conversation.subjectName
            ? { subjectName: this.conversation.subjectName }
            : {}),
          tutorProfiles: this.conversation.tutors,
        });
        const firstResponseInstructions = this.firstCallerResponse
          ? [
              personalWalletPriorityInstructions(this.deps.toolContext.locale),
              firstCallerResponseInstructions(this.deps.toolContext.locale),
              roleToolVisibilityInstructions(this.deps.toolContext.locale),
              catalogFollowUpInstructions(this.deps.toolContext.locale),
            ]
          : [];
        this.firstCallerResponse = false;
        this.responseCreatePending = true;
        this.deps.sideband.send({
          type: 'response.create',
          response: {
            instructions: [
              callerTurnPriorityInstructions(this.deps.toolContext.locale),
              "Start directly with the useful result. Call fast catalog, tutor-directory, account, and action tools silently, without acknowledgment or progress narration. Live tutor-calendar and eligibility lookups must use exactly one brief, request-specific waiting sentence before their tool call. Only search_knowledge may use its own required single question-specific waiting sentence. Never praise or assess the caller's question and never say 'Nice question,' 'Great question,' 'Great choice,' 'Awesome,' 'Amazing,' 'Perfect,' 'Let me think,' 'I’ll check that for you,' or similar filler. For a tutor request about any subject, field, or broad topic, call search_tutor_profiles with the caller's complete topic phrase in subjectName; never omit the filter or interpret an unfiltered sample of profiles yourself. Give one result and at most one necessary next question; never end with a generic offer of help.",
              "Keep the call's current language unless the caller explicitly requests another language or speaks at least four consecutive recognizable words in it. For an unclear or shorter foreign-language fragment, stay in the current language and ask once for repetition; never invent an intent or switch languages.",
              "Resolve 'this course', 'that course', 'these courses', 'this subject', 'that subject', 'it', and equivalent references to the most recently established exact course or subject in the conversation. For example, after listing Math tutors, 'Am I eligible to take these courses?' means the Math subject, and a later bundle request still means Math. Do not ask for the course name again when that reference is unambiguous. If the caller is verified and check_subject_eligibility is listed, call it silently. If this browser call is unverified, use the browser account-details instruction exactly and never ask for a member ID during the call.",
              'After check_subject_eligibility returns not_eligible or no_credits, that eligibility check is complete. Never say it still needs verification and never read unrelated wallet bundles. If the caller asks which bundles cover the same subject, keep that subject and use recommend_course_bundle when listed; do not restart with get_subjects or ask for the subject again. Present all returned matching bundles as neutral choices and never recommend or rank one.',
              "Treat the word 'methods' literally. Never reinterpret it as 'Math' unless the caller also says tutor, course, subject, or mathematics; ask one short clarification question when the request is ambiguous.",
              'After a tutor list, if the caller asks whether that was the complete result or repeats one returned name, answer only with a brief confirmation. Never rename, correct, or invent the requested tutor subject or category.',
              "Never infer a course's content, curriculum, workflow, projects, or learning outcomes from its title. In a follow-up about a subject returned by a tutor profile, state only whether the returned tutor teaches that exact subject unless a factual knowledge tool returns additional details.",
              ...(this.deps.toolContext.verificationAvailable === false &&
              !this.customerVerified
                ? [
                    'This browser call started without verified account details. For any booking, eligibility, wallet, or other protected request, say exactly once: “Account details are required for this action. End the call, enter both your phone number and member ID, then start a new call.” Do not describe in-call verification, ask for an ID, offer another verification process, or repeat this message.',
                  ]
                : []),
              ...(forceMemberIdRequest
                ? [
                    'The caller requested a protected booking or verification action. Call request_member_id now. Do not say that booking, eligibility, or verification tools are unavailable, and do not speak the member-ID question yourself; the tool result supplies it once.',
                  ]
                : []),
              ...(forceCourseEligibilityCheck
                ? [
                    `The caller requested a booking or eligibility check, and this call is already verified. First say exactly one short, friendly waiting sentence tied to the established course, such as “I’ll check whether your current access covers Math now.” Then immediately output exactly one check_subject_eligibility function call in the same response with ${this.conversation.subjectName ? `the established subjectName “${this.conversation.subjectName}”` : 'the exact course name from the caller'}. Do not add a second waiting sentence, praise, generic filler, verification language, wallet details, availability, or a result before the tool returns. Do not claim that booking or eligibility is unavailable.`,
                  ]
                : []),
              ...(forceTutorCalendarLookup
                ? [
                    `The caller is already server-verified. FUNCTION-CALL-ONLY: immediately output exactly one check_tutor_calendar function call. Produce zero text and zero audio before it. The server-preserved tutor list is ${JSON.stringify(this.conversation.tutors)}. Resolve approximate spoken names and ordinal references only against this list. For one tutor, pass that exact id and fullName as tutorId and tutorName. If the caller says any of them, any tutor, nearest, earliest, or first available, pass every entry as tutors so the tool compares their calendars. Never invent an id or mention verification.`,
                  ]
                : []),
              ...(forceTutorProfileLookup
                ? [
                    "FUNCTION-CALL-ONLY TURN: output exactly one search_tutor_profiles call using the caller's complete requested subject or topic in subjectName. Produce zero text and zero audio before the function call. Do not acknowledge, narrate, praise the question, or call search_knowledge.",
                  ]
                : []),
              ...(forceUnverifiedTutorCalendarNotice
                ? [
                    'The caller requested live tutor availability, which is a protected action, but this browser call has no verified account details. Say exactly: “Account details are required for this action. End the call, enter both your phone number and member ID, then start a new call.” Say nothing else, do not suggest the website or directory, and do not ask for a member ID during the call.',
                  ]
                : []),
              ...(forceCourseBookingStart
                ? [
                    'The verified caller explicitly asked to book a named course. Call start_course_booking now with the exact course name and only preferences the caller actually stated. Make the tool call silently: do not speak, acknowledge, narrate, or call separate eligibility, tutor, or availability tools first.',
                  ]
                : []),
              ...(forceBookCourse
                ? [
                    'The caller explicitly confirmed the prepared booking. First say exactly one short, friendly waiting sentence, such as “I’ll complete that booking now.” Then immediately output exactly one book_course function call in the same response using the identical server-preserved prepared selection. Do not add a second waiting sentence, repeat the booking summary, prepare again, ask another confirmation question, or claim success before the tool result. Say the booking succeeded only when book_course returns status booked.',
                  ]
                : []),
              ...(forceCancelCourse
                ? [
                    'FUNCTION-CALL-ONLY TURN: the caller explicitly confirmed the prepared cancellation. Output exactly one cancel_course function call. Produce zero text and zero audio before the function call. The server will use the preserved selected session. Do not ask for confirmation again, retry, mention denial, or claim success before the tool result.',
                  ]
                : []),
              ...(forceCancellationLookup
                ? [
                    'FUNCTION-CALL-ONLY TURN: the verified caller asked to cancel a session. Output exactly one get_my_courses function call with scope="upcoming" and intent="cancel". Produce zero text and zero audio before the function call. Do not reuse a previous view-only result, call cancel_course yet, or ask for confirmation before this tool returns.',
                  ]
                : []),
              ...(forceAccountLookupTool
                ? [
                    `The caller asked for their personal account information and this call is already verified. Call ${forceAccountLookupTool} now; do not claim verification is unavailable or answer without the tool result.`,
                  ]
                : []),
              ...(forceBundleRecommendation && this.conversation.subjectName
                ? [
                    `FUNCTION-CALL-ONLY TURN: output exactly one recommend_course_bundle function call with subjectName set to the previously resolved exact subject “${this.conversation.subjectName}”, another=false${forcedBundleLevelName ? `, and levelName set exactly to “${forcedBundleLevelName}”` : forcedBundleAnyLevel ? ', and anyLevel=true' : ', with no levelName and anyLevel=false'}. Produce zero text and zero audio before the function call. Do not repeat eligibility, list wallet bundles, ask for verification, call get_subjects, ask for the subject again, or substitute another level.`,
                  ]
                : []),
              ...firstResponseInstructions,
              callerIntentPolicy(this.deps.toolContext.locale),
              accountAccessPolicy(
                this.customerVerified,
                this.baseline.tools?.split(',').filter(Boolean) ?? [],
              ),
            ].join('\n'),
            tool_choice: routeContract.toolChoice,
            ...(routeContract.textOnly ? { output_modalities: ['text'] } : {}),
            ...(routeContract.textOnly
              ? {
                  metadata: {
                    tutwithus_response_kind: 'tool_routing',
                  },
                }
              : {}),
          },
        });
      } else {
        this.responseCreatePending = true;
        this.deps.sideband.send(
          toolResponseInstructions
            ? {
                type: 'response.create',
                response: {
                  instructions: [
                    toolResponseInstructions,
                    accountAccessPolicy(
                      this.customerVerified,
                      this.baseline.tools?.split(',').filter(Boolean) ?? [],
                    ),
                  ].join('\n'),
                  tool_choice: toolResponseForcedToolName
                    ? { type: 'function', name: toolResponseForcedToolName }
                    : toolResponseAllowsTools
                      ? 'auto'
                      : 'none',
                },
              }
            : { type: 'response.create' },
        );
      }
    }
  }

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  private tick(): void {
    if (this.stopped || this.ending) {
      return;
    }
    const now = Date.now();
    if (now - this.startedAt >= this.deps.limits.maxCallSec * 1000) {
      this.beginEnding('max_duration');
      return;
    }
    const busy =
      this.userSpeaking ||
      this.responseCreatePending ||
      this.activeResponses.size > 0 ||
      this.toolRuns.size > 0;
    if (
      !busy &&
      now - this.lastActivityAt >= this.deps.limits.idleTimeoutSec * 1000
    ) {
      this.beginEnding('idle_timeout');
    }
  }

  // Ends the call politely: the model says goodbye, then the call is hung up.
  private beginEnding(reason: string): void {
    this.ending = { reason, awaitingGoodbye: false, goodbyeDone: false };
    const inFlight = [...this.activeResponses].at(-1);
    if (inFlight) {
      // The response already in progress serves as the goodbye.
      this.ending.goodbyeResponseId = inFlight;
    } else {
      this.ending.awaitingGoodbye = true;
      this.responseCreatePending = true;
      this.deps.sideband.send({
        type: 'response.create',
        response: { instructions: GOODBYE_INSTRUCTIONS, tool_choice: 'none' },
      });
    }
    this.armEndTimer(GOODBYE_TIMEOUT_MS);
  }

  private armEndTimer(delayMs: number): void {
    if (this.endTimer) {
      clearTimeout(this.endTimer);
    }
    const reason = this.ending?.reason ?? 'ended';
    this.endTimer = setTimeout(() => void this.stop(reason), delayMs);
    this.endTimer.unref();
  }
}
import { callerIntentPolicy } from '../agent/caller-intent-policy.js';
