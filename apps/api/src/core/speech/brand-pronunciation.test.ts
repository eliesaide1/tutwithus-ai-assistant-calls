import { describe, expect, it } from 'vitest';
import {
  normalizeTextForSpeech,
  TUTWITHUS_PRONUNCIATION_RULES,
} from './brand-pronunciation.js';

describe('TutWithUs speech pronunciation', () => {
  it('keeps brand pronunciation locale-specific', () => {
    expect(TUTWITHUS_PRONUNCIATION_RULES.en).toContain(
      '“Tute” must rhyme exactly with “cute” and “mute”.',
    );
    expect(TUTWITHUS_PRONUNCIATION_RULES.fr).toContain(
      'Never pronounce it as “Tut With Us” or “tut”',
    );
    expect(TUTWITHUS_PRONUNCIATION_RULES['ar-SA']).toContain(
      'انطق TutWithUs مرة واحدة بلفظ «تيوت وِذ أَس»',
    );
    expect(TUTWITHUS_PRONUNCIATION_RULES['ar-SA']).not.toContain(
      'Tute With Us',
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
