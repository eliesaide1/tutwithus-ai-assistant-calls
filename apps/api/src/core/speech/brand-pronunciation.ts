import type { Locale } from '@tutwithus/contracts';

export const TUTWITHUS_SPOKEN_NAME = 'Tute With Us';

const englishBrandPronunciationRule =
  'Pronunciation rule: whenever you say “TutWithUs”, pronounce it as “Tute With Us”. “Tute” must rhyme exactly with “cute” and “mute”. Never pronounce it as “Tut With Us” or “tut”, and do not spell it out as separate letters.';

export const TUTWITHUS_PRONUNCIATION_RULES: Record<Locale, string> = {
  'ar-SA':
    'في الكلام العربي، انطق TutWithUs مرة واحدة بلفظ «تيوت وِذ أَس». لا تضف بعده النطق الإنجليزي، ولا تكرر «أَس»، ولا تنطق الاسم حرفًا حرفًا.',
  en: englishBrandPronunciationRule,
  fr: englishBrandPronunciationRule,
};

export const SPEECH_TEXT_REPLACEMENTS = {
  TutWithUs: TUTWITHUS_SPOKEN_NAME,
} as const;

export function normalizeTextForSpeech(text: string): string {
  return text.replace(/TutWithUs/giu, TUTWITHUS_SPOKEN_NAME);
}
