import { describe, expect, it } from 'vitest';
import { buildAgentProfile } from '../agent/agent-profile.js';
import { SAUDI_ARABIC_SPEECH_GUIDE } from './saudi-arabic-speech.js';

describe('Saudi Arabic speech guidance', () => {
  it('uses a Saudi default and preserves configured greetings for each locale', () => {
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

    expect(buildAgentProfile('ar-SA').greeting).toBe(
      'هلا، أنا المساعد الذكي في تيوت وِذ أَس. وش أقدر أساعدك فيه؟',
    );
    expect(buildAgentProfile('ar-SA', settings).greeting).toBe(
      'مرحبًا، أنا المساعد الذكي في TutWithUs.',
    );
    expect(buildAgentProfile('en', settings).greeting).toBe(
      'Welcome to TutWithUs.',
    );
    expect(buildAgentProfile('fr', settings).greeting).toBe(
      'Bienvenue chez TutWithUs.',
    );
  });

  it('adds Saudi speech examples only to Saudi Arabic profiles', () => {
    const arabicInstructions = buildAgentProfile('ar-SA').instructions;
    expect(arabicInstructions).toContain(SAUDI_ARABIC_SPEECH_GUIDE);
    expect(arabicInstructions).toContain(
      'لا تستخدم العربية الفصحى في الردود الصوتية، حتى إذا طلبها المتصل',
    );
    expect(arabicInstructions).not.toContain('استخدم الفصحى المبسطة');
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
      'استخدم spokenSummary المعاد من check_tutor_calendar بوصفه المصدر الوحيد',
    );
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain(
      'لا تحوّل كلمات الأعداد إلى أرقام',
    );
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain('دون بطء أو تقطيع للمقاطع');
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain('لا تكرر «أَس»');
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain(
      'نتائج الأدوات المعادة مصادر معتمدة',
    );
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain(
      'لا تستخدم تحقق البريد إلا إذا طلبه مسار أداة مدرج',
    );
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain('لا تستنتج جنس المعلم من اسمه');
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain(
      'أمثلة الصياغة أدناه للأسلوب فقط',
    );
  });
});
