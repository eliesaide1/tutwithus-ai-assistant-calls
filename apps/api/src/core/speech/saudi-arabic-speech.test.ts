import { describe, expect, it } from 'vitest';
import { buildAgentProfile } from '../agent/agent-profile.js';
import { SAUDI_ARABIC_SPEECH_GUIDE } from './saudi-arabic-speech.js';

describe('Saudi Arabic speech guidance', () => {
  it('uses an identity-first Saudi opening greeting by default', () => {
    expect(buildAgentProfile('ar-SA').greeting).toBe(
      'هلا، أنا المساعد الذكي في تيوت وِذ أَس. وش أقدر أساعدك فيه؟',
    );
    expect(buildAgentProfile('en').greeting).toBe(
      'Thank you for calling TutWithUs. How may I help you today?',
    );
  });

  it('normalizes Latin brand names only in configured Arabic greetings', () => {
    const settings = {
      greeting: {
        'ar-SA': 'مرحبًا، أنا المساعد الذكي في TutWithUs.',
        en: 'Welcome to TutWithUs.',
        fr: 'Bienvenue chez TutWithUs.',
      },
      instructionTemplate: '',
      voice: 'marin' as const,
      businessHours: 'Sunday to Thursday',
      escalation: { hoursText: 'Call us.' },
    };

    expect(buildAgentProfile('ar-SA', settings).greeting).toBe(
      'مرحبًا، أنا المساعد الذكي في تيوت وِذ أَس.',
    );
    expect(buildAgentProfile('en', settings).greeting).toBe(
      'Welcome to TutWithUs.',
    );
    expect(buildAgentProfile('fr', settings).greeting).toBe(
      'Bienvenue chez TutWithUs.',
    );
  });

  it('adds Saudi speech examples only to Saudi Arabic profiles', () => {
    expect(buildAgentProfile('ar-SA').instructions).toContain(
      SAUDI_ARABIC_SPEECH_GUIDE,
    );
    expect(buildAgentProfile('en').instructions).not.toContain(
      SAUDI_ARABIC_SPEECH_GUIDE,
    );
    expect(buildAgentProfile('fr').instructions).not.toContain(
      SAUDI_ARABIC_SPEECH_GUIDE,
    );
  });

  it('provides short Saudi phrasing examples without scripted answers', () => {
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain('«وش»');
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain('«موعدين»');
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain('Elie Saide');
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain('اذكر ما أعادته الأداة فقط');
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain(
      'أمثلة الصياغة أدناه للأسلوب فقط',
    );
  });
});
