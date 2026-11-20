import type { Locale } from '@tutwithus/contracts';
import { z } from 'zod';
import { defineTool } from '../core/tools/tool-registry.js';
import { callerIntentPolicy } from '../core/agent/caller-intent-policy.js';

export type WhatsAppRegistrationStatus =
  'registered' | 'not_registered' | 'unavailable';
export async function lookupWhatsAppRegistration(
  directory: {
    lookup(query: {
      phone: string;
    }): Promise<{ status: WhatsAppRegistrationStatus }>;
  },
  phone: string | undefined,
): Promise<WhatsAppRegistrationStatus> {
  if (!phone) return 'unavailable';
  try {
    return (await directory.lookup({ phone })).status;
  } catch {
    return 'unavailable';
  }
}

export const registrationMessages: Record<Locale, string> = {
  en: 'Sorry, you need to create an account in TutWithUs, then come back and we can help you. For now, I am ready to answer any question you have about TutWithUs.',
  fr: 'Désolé, vous devez créer un compte TutWithUs, puis revenir pour que nous puissions vous aider. Pour le moment, je peux répondre à vos questions générales sur TutWithUs.',
  'ar-SA':
    'عذرًا، تحتاج إلى إنشاء حساب في TutWithUs ثم العودة لنتمكن من مساعدتك. حاليًا أنا جاهز للإجابة عن أي سؤال عام لديك عن TutWithUs.',
};

type MemberLoginResult =
  | { status: 'verified'; accessToken: string; role: string }
  | { status: 'not_verified' }
  | { status: 'unavailable' };

export interface WhatsAppMemberDirectory {
  loginMember(query: {
    phone: string;
    memberId: string;
  }): Promise<MemberLoginResult>;
}

export const accountMessages: Record<
  Locale,
  {
    mismatch: string;
    unavailable: string;
    askId: string;
    verifiedInstruction: string;
  }
> = {
  en: {
    mismatch:
      'Sorry, the ID you provided did not match your phone number. For now, I am ready to answer any question you have about TutWithUs.',
    unavailable:
      'Sorry, I could not verify your account right now. Please try again later. I can still answer general questions about TutWithUs.',
    askId: 'Please tell me your TutWithUs member ID.',
    verifiedInstruction:
      'Verification succeeded. Do not speak a separate verification confirmation. The server has refreshed the tools for the verified role. Continue the pending request using only matching tools listed for this caller. For a general question about which courses the caller’s wallet gives access to without a named course, call get_my_wallet with includeCourseAccessLevels=true, report positiveCreditLevels, note if the list is incomplete, and explain that positive-credit levels do not confirm eligibility for every individual course. Invite them to name a specific course and call check_subject_eligibility when they do. For eligibility or booking of one named course, call check_subject_eligibility once with the original course name; do not call get_subjects or get_my_wallet separately for that flow. If eligible and booking remains pending, pass the returned subjectId and levelId unchanged to find_booking_tutors and continue only with listed booking tools. For wallet-only requests about current bundles, subscriptions, or remaining credits, call get_my_wallet. For bootcamp requests, call get_my_bootcamps. For ordinary wallet results, report each returned bundleName and its credits; reveal level names only for a general course-access request. Do not invent bundle names or change the returned credits. Public questions about available bundles or prices do not need verification. For their own availability, call get_my_tutor_availability only if listed; if it is absent, do not attempt it or imply the lookup is available. If a required action tool is not listed after verification, explain that the action is unavailable; do not attempt a hidden tool. Do not ask the caller to repeat the request or name the tool.',
  },
  'ar-SA': {
    mismatch:
      'عذرًا، رقم العضوية الذي قدمته لا يتطابق مع رقم هاتفك. حاليًا أنا جاهز للإجابة عن أي سؤال عام لديك عن TutWithUs.',
    unavailable:
      'عذرًا، لم أتمكن من التحقق من حسابك الآن. يُرجى المحاولة لاحقًا. ويمكنني الاستمرار في الإجابة عن الأسئلة العامة حول TutWithUs.',
    askId: 'ما رقم عضويتك في TutWithUs؟',
    verifiedInstruction:
      'نجح التحقق. لا تقدم تأكيدًا منفصلًا للمتصل. حدّث الخادم الأدوات المتاحة للدور الذي تم التحقق منه، ثم تابع الطلب باستخدام الأدوات المطابقة والمدرجة فقط. إذا سأل المتصل بشكل عام عن الدورات التي تتيحها محفظته دون تسمية دورة، فاستدعِ get_my_wallet مع includeCourseAccessLevels=true واذكر positiveCreditLevels مع توضيح إن كانت القائمة جزئية، واشرح أن هذه المستويات لا تؤكد أهلية كل دورة. اطلب منه تسمية دورة محددة لفحصها عبر check_subject_eligibility. لأهلية دورة محددة أو حجزها، استدعِ check_subject_eligibility مرة واحدة مع اسم الدورة الأصلي؛ ولا تستدعِ get_subjects أو get_my_wallet منفصلتين لهذا المسار. إذا ثبتت الأهلية وكان الحجز قيد المتابعة، فمرّر subjectId وlevelId المعادين دون تغيير إلى find_booking_tutors وتابع بأدوات الحجز المدرجة فقط. لطلبات المحفظة فقط عن الباقات أو الاشتراكات الحالية أو الأرصدة المتبقية، استدعِ get_my_wallet. لطلبات المعسكرات، استدعِ get_my_bootcamps. اذكر bundleName وcredits فقط في نتائج المحفظة العادية، ولا تكشف أسماء المستويات إلا لطلب الوصول العام للدورات. لا تخمّن أسماء الباقات ولا تغيّر الأرصدة المعادة. الأسئلة العامة عن الباقات المتاحة أو أسعارها لا تتطلب التحقق. لطلب مواعيد المعلم نفسه، استدعِ get_my_tutor_availability فقط إذا كانت مدرجة؛ وإذا لم تكن مدرجة فلا تحاول استخدامها ولا توحِ بأنها متاحة. إذا لم تكن أداة الإجراء المطلوبة مدرجة بعد التحقق، فوضّح أن الإجراء غير متاح ولا تحاول استدعاء أداة مخفية. لا تطلب تكرار الطلب أو تسمية الأداة.',
  },
  fr: {
    mismatch:
      'Désolé, l’identifiant fourni ne correspond pas à votre numéro de téléphone. Pour le moment, je peux répondre à vos questions générales sur TutWithUs.',
    unavailable:
      'Désolé, je ne peux pas vérifier votre compte pour le moment. Veuillez réessayer plus tard. Je peux toujours répondre aux questions générales sur TutWithUs.',
    askId: 'Veuillez me communiquer votre identifiant membre TutWithUs.',
    verifiedInstruction:
      'La vérification a réussi. Ne donnez pas de confirmation séparée à la personne. Le serveur a actualisé les outils disponibles pour le rôle vérifié. Reprenez sa demande en utilisant uniquement les outils correspondants qui sont listés. Pour une question générale, sans cours nommé, sur les cours auxquels le portefeuille donne accès, appelez get_my_wallet avec includeCourseAccessLevels=true, indiquez positiveCreditLevels et précisez si la liste est partielle ; expliquez que ces niveaux ne confirment pas l’éligibilité de chaque cours. Invitez la personne à nommer un cours précis pour check_subject_eligibility. Pour l’éligibilité ou la réservation d’un cours précis, appelez une seule fois check_subject_eligibility avec le nom original du cours ; n’appelez pas séparément get_subjects ni get_my_wallet pour ce parcours. Si la personne est éligible et qu’une réservation est en attente, transmettez les subjectId et levelId renvoyés sans les modifier à find_booking_tutors et poursuivez uniquement avec les outils de réservation listés. Pour une demande portant uniquement sur le portefeuille, ses forfaits/abonnements actuels ou ses crédits restants, appelez get_my_wallet. Pour les bootcamps, appelez get_my_bootcamps. Pour une question ordinaire sur le portefeuille, indiquez chaque bundleName et son nombre de crédits ; ne révélez les noms de niveaux que pour une demande générale d’accès aux cours. N’inventez aucun nom de forfait et ne modifiez pas les crédits renvoyés. Les questions générales sur les forfaits disponibles ou leurs prix ne nécessitent pas de vérification. Pour ses propres disponibilités, appelez get_my_tutor_availability uniquement s’il est listé ; sinon, ne tentez pas de l’utiliser et ne laissez pas entendre que la consultation est possible. Si l’outil d’action requis n’est pas listé après la vérification, dites que l’action n’est pas disponible et ne tentez pas d’appeler un outil masqué. Ne demandez pas à la personne de répéter sa demande ni de nommer l’outil.',
  },
};

export function createVerifyMemberIdTool(options: {
  directory: WhatsAppMemberDirectory;
  phone: string | undefined;
  locale: Locale;
  registrationStatus: WhatsAppRegistrationStatus;
}) {
  const messages = accountMessages[options.locale];
  const availabilityContinuation: Record<Locale, string> = {
    en: 'For a pending request about the tutor’s own availability, call get_my_tutor_availability as soon as it is listed. Preserve the requested period, filter the returned entries to that period using today’s date and the call time zone, and do not ask for a day or time the caller already gave.',
    fr: 'Pour une demande en attente sur les disponibilités personnelles du tuteur, appelez get_my_tutor_availability dès qu’il est listé. Conservez la période demandée, filtrez les entrées renvoyées selon cette période en utilisant la date du jour et le fuseau horaire de l’appel, et ne redemandez pas un jour ou un horaire déjà indiqué.',
    'ar-SA':
      'إذا كان الطلب المعلّق عن مواعيد المعلم نفسه، فاستدعِ get_my_tutor_availability فور إدراجها. احتفظ بالفترة المطلوبة، ورشّح النتائج بحسبها باستخدام تاريخ اليوم والمنطقة الزمنية للمكالمة، ولا تطلب يومًا أو وقتًا ذكره المتصل بالفعل.',
  };
  return defineTool({
    name: 'verify_member_id',
    access: { kind: 'public' },
    description:
      'Use only after the caller requests a sensitive or account-specific TutWithUs action. Ask for their TutWithUs member ID, then verify it with this tool. Do not use for public knowledge questions. Never repeat or reveal the member ID. Do not claim verification unless this tool succeeds.',
    parameters: z
      .object({ memberId: z.string().trim().min(1).max(128) })
      .strict(),
    maxCallsPerSession: 3,
    redact: () => ({ memberIdProvided: true }),
    async execute({ memberId }) {
      if (options.registrationStatus !== 'registered') {
        const message =
          options.registrationStatus === 'not_registered'
            ? registrationMessages[options.locale]
            : messages.unavailable;
        return {
          output: { status: options.registrationStatus, instruction: message },
          customerVerified: false,
          accountAccessHint: message,
        };
      }
      if (!options.phone) {
        return {
          output: {
            status: 'unavailable',
            instruction: messages.unavailable,
          },
          customerVerified: false,
          accountAccessHint: messages.unavailable,
        };
      }
      try {
        const result = await options.directory.loginMember({
          phone: options.phone,
          memberId,
        });
        if (result.status === 'verified') {
          return {
            output: {
              status: 'verified',
              instruction: `${messages.verifiedInstruction}\n${availabilityContinuation[options.locale]}\n${callerIntentPolicy(options.locale)}`,
            },
            customerVerified: true,
            serverAccessToken: result.accessToken,
            serverRole: result.role.toLowerCase(),
          };
        }
        const message =
          result.status === 'not_verified'
            ? messages.mismatch
            : messages.unavailable;
        return {
          output: {
            status: result.status,
            instruction: message,
          },
          customerVerified: false,
          accountAccessHint: message,
        };
      } catch {
        return {
          output: { status: 'unavailable', instruction: messages.unavailable },
          customerVerified: false,
          accountAccessHint: messages.unavailable,
        };
      }
    },
  });
}
