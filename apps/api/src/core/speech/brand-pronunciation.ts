export const TUTWITHUS_SPOKEN_NAME = 'Tute With Us';

export const TUTWITHUS_PRONUNCIATION_RULE =
  'Pronunciation rule: whenever you say “TutWithUs”, pronounce it as “Tute With Us” in every language. “Tute” must rhyme exactly with “cute” and “mute”. Never pronounce it as “Tut With Us” or “tut”, and do not spell it out as separate letters.';

export const SPEECH_TEXT_REPLACEMENTS = {
  TutWithUs: TUTWITHUS_SPOKEN_NAME,
} as const;

export function normalizeTextForSpeech(text: string): string {
  return text.replace(/TutWithUs/giu, TUTWITHUS_SPOKEN_NAME);
}
