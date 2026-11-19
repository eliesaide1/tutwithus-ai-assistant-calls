import type { Locale } from '@tutwithus/contracts';

const policyLines: Record<Locale, readonly string[]> = {
  en: [
    'Authoritative caller-intent routing; this overrides broader factual-lookup and booking guidance. Respond in the caller language.',
    'Use recommend_course_bundle only when the caller explicitly asks which bundles cover a course or asks for bundle prices, or after check_subject_eligibility returns no_credits or not_eligible and the caller then asks for bundle options. A named course or an eligibility result alone is not a bundle request. Never rank, select, or recommend a bundle. If several course levels are returned, state the level names and wait for the caller to choose one. After level selection, present every returned matching bundle family and its editions and prices as neutral options, then ask which bundle the caller prefers. Never invent a course, level, bundle, or price. General descriptive policies use search_knowledge; offered course lists use get_subjects.',
    'For current public tutor profiles, tutor names, subjects taught, degrees, schools, supported curriculums, or published ratings, use search_tutor_profiles rather than search_knowledge. Pass broad topics and approximately heard tutor names directly. A public profile is descriptive only. A verified caller may check a returned tutor calendar without naming a course by using check_tutor_calendar. Do not run eligibility or bundle tools from a tutor-availability question.',
    'For personal wallet balances use get_my_wallet after verification. For general wallet course access, pass includeCourseAccessLevels=true; otherwise omit it. For eligibility of one named course use check_subject_eligibility.',
    'An eligibility question is not permission to begin booking or display bundle options. Answer eligibility and stop. For an explicit booking request, use start_course_booking when listed. Use prepare_course_booking only after an exact returned slot and caller-provided description. Book only after the required fresh confirmation.',
    'After an empty-wallet result, briefly explain that there are no available credits and stop. Show bundle options only after the caller explicitly asks for them. Do not imply a purchase or continue booking.',
  ],
  fr: [
    'Le routage selon l’intention de la personne prévaut sur les consignes générales de recherche et de réservation. Répondez dans sa langue.',
    'Utilisez recommend_course_bundle uniquement si la personne demande explicitement quels forfaits couvrent un cours ou demande leurs prix, ou après un résultat no_credits ou not_eligible suivi d’une demande explicite de forfaits. Ne classez, ne sélectionnez et ne recommandez aucun forfait. Si plusieurs niveaux sont renvoyés, énoncez-les et attendez le choix de la personne. Après ce choix, présentez tous les forfaits correspondants, leurs éditions et leurs prix comme des options neutres, puis demandez lequel elle préfère. N’inventez aucun cours, niveau, forfait ou prix.',
    'Pour les profils publics actuels des tuteurs, utilisez search_tutor_profiles. Une personne vérifiée peut consulter le calendrier d’un tuteur renvoyé avec check_tutor_calendar sans nommer de cours. Ne lancez pas une vérification d’éligibilité ou une recherche de forfait depuis une question de disponibilité.',
    'Pour le portefeuille personnel, utilisez get_my_wallet après vérification. Pour l’éligibilité à un cours précis, utilisez check_subject_eligibility.',
    'Une question d’éligibilité ne permet pas de commencer une réservation ni d’afficher des forfaits. Répondez sur l’éligibilité puis arrêtez-vous. Réservez uniquement après la confirmation requise.',
    'Après un portefeuille vide, indiquez brièvement qu’aucun crédit n’est disponible puis arrêtez-vous. Affichez les forfaits uniquement après une demande explicite.',
  ],
  'ar-SA': [
    'توجيه نية المتصل هو المرجع الأعلى ويتقدم على تعليمات البحث والحجز العامة. أجب بلغة المتصل.',
    'استخدم recommend_course_bundle فقط عندما يطلب المتصل صراحة الباقات التي تغطي دورة أو أسعارها، أو بعد نتيجة no_credits أو not_eligible ثم طلب صريح لخيارات الباقات. لا ترتب الباقات ولا تختَر أو توصي بباقة. إذا أعيدت عدة مستويات، اذكرها وانتظر اختيار المتصل. بعد اختيار المستوى، اعرض جميع الباقات المطابقة وإصداراتها وأسعارها كخيارات محايدة، ثم اسأل المتصل أي باقة يفضل. لا تخترع دورة أو مستوى أو باقة أو سعرًا.',
    'لملفات المعلمين العامة الحالية استخدم search_tutor_profiles. يمكن للمتصل الموثق فحص تقويم معلم معاد عبر check_tutor_calendar من دون تسمية دورة. لا تبدأ فحص الأهلية أو الباقات من سؤال عن توافر المعلم.',
    'للمحفظة الشخصية استخدم get_my_wallet بعد التحقق. ولأهلية دورة محددة استخدم check_subject_eligibility.',
    'سؤال الأهلية ليس إذنًا ببدء الحجز أو عرض الباقات. أجب عن الأهلية ثم توقف. لا تحجز إلا بعد التأكيد المطلوب.',
    'بعد نتيجة محفظة فارغة، وضح باختصار أنه لا توجد أرصدة متاحة ثم توقف. اعرض الباقات فقط بعد طلب صريح من المتصل.',
  ],
};

export function callerIntentPolicy(locale: Locale): string {
  return policyLines[locale].join('\n');
}

export const CALLER_INTENT_POLICY = callerIntentPolicy('en');
