const NON_SPEECH_MARKER =
  /(?:\[(?:noise|silence|laughter|laughing|music|inaudible|unintelligible|crosstalk)\]|\((?:noise|silence|laughter|laughing|music|inaudible|unintelligible|crosstalk)\))/giu;

const FILLER_ONLY = new Set([
  'ah',
  'eh',
  'hmm',
  'hm',
  'mhm',
  'mm',
  'mmm',
  'uh',
  'uhh',
  'um',
  'umm',
  'euh',
  'hum',
  'heu',
  'اه',
  'آه',
  'امم',
  'اممم',
  'مم',
  'ممم',
]);

export function containsRecognizableWords(value: string | undefined): boolean {
  const transcript = value?.normalize('NFKC').trim();
  if (!transcript) {
    return false;
  }

  const speechText = transcript.replace(NON_SPEECH_MARKER, ' ').trim();
  const words = speechText.match(/\p{L}[\p{L}\p{M}\p{N}]*/gu) ?? [];
  return (
    words.some((word) => !FILLER_ONLY.has(word.toLowerCase())) ||
    /\p{N}/u.test(speechText)
  );
}
