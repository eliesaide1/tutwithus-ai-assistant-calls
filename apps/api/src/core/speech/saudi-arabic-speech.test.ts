import { describe, expect, it } from 'vitest';
import { buildAgentProfile } from '../agent/agent-profile.js';
import { SAUDI_ARABIC_SPEECH_GUIDE } from './saudi-arabic-speech.js';

describe('Saudi Arabic speech guidance', () => {
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
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain('«أشيّك لك على المواعيد.»');
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain(
      'اذكر المعلومات التي أعادتها الأداة فقط',
    );
    expect(SAUDI_ARABIC_SPEECH_GUIDE).toContain(
      'أمثلة للأسلوب وليست نصوصًا ثابتة',
    );
  });
});
