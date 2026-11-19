import { describe, expect, it } from 'vitest';
import {
  normalizeTextForSpeech,
  TUTWITHUS_PRONUNCIATION_RULE,
} from './brand-pronunciation.js';

describe('TutWithUs speech pronunciation', () => {
  it('uses the requested cute and mute pronunciation guidance', () => {
    expect(TUTWITHUS_PRONUNCIATION_RULE).toContain(
      '“Tute” must rhyme exactly with “cute” and “mute”.',
    );
    expect(TUTWITHUS_PRONUNCIATION_RULE).toContain(
      'Never pronounce it as “Tut With Us” or “tut”',
    );
  });

  it('normalizes every brand mention before external speech synthesis', () => {
    expect(normalizeTextForSpeech('TutWithUs welcomes you to tutwithus.')).toBe(
      'Tute With Us welcomes you to Tute With Us.',
    );
  });

  it('does not change unrelated words', () => {
    expect(normalizeTextForSpeech('A cute tutor can help.')).toBe(
      'A cute tutor can help.',
    );
  });
});
