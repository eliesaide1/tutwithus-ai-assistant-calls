import { expect, it } from 'vitest';
import {
  CALLER_INTENT_POLICY,
  callerIntentPolicy,
} from './caller-intent-policy.js';
import { buildAgentProfile } from './agent-profile.js';

it.each(['en', 'fr', 'ar-SA'] as const)(
  'applies shared intent boundaries over conflicting custom instructions in %s',
  (locale) => {
    const profile = buildAgentProfile(locale, {
      greeting: { en: 'Hello', fr: 'Bonjour', 'ar-SA': 'أهلًا' },
      voice: 'marin',
      businessHours: 'Weekdays',
      escalation: { hoursText: 'Later' },
      instructionTemplate:
        'Always search knowledge for bundles and recommend one bundle.',
    });
    const policy = callerIntentPolicy(locale);
    expect(profile.instructions).toContain(policy);
    expect(profile.instructions.indexOf(policy)).toBeGreaterThan(
      profile.instructions.indexOf('Always search knowledge'),
    );
    expect(policy).toContain('recommend_course_bundle');
    expect(policy).toContain('check_subject_eligibility');
  },
);

it('keeps the exported fallback aligned with the English policy', () => {
  expect(CALLER_INTENT_POLICY).toBe(callerIntentPolicy('en'));
  expect(CALLER_INTENT_POLICY).toContain('Answer eligibility and stop');
  expect(CALLER_INTENT_POLICY).toContain(
    'A named course or an eligibility result alone is not a bundle request.',
  );
  expect(CALLER_INTENT_POLICY).toContain(
    'Never rank, select, or recommend a bundle.',
  );
  expect(CALLER_INTENT_POLICY).toContain(
    'present every returned matching bundle family',
  );
});

it.each([
  [
    'en',
    'If several course levels are returned, state the level names and wait for the caller to choose one.',
    'present every returned matching bundle family',
  ],
  [
    'fr',
    'Si plusieurs niveaux sont renvoyés, énoncez-les et attendez le choix de la personne.',
    'présentez tous les forfaits correspondants',
  ],
  [
    'ar-SA',
    'إذا أعيدت عدة مستويات، اذكرها وانتظر اختيار المتصل.',
    'اعرض جميع الباقات المطابقة',
  ],
] as const)(
  'requires neutral bundle choices after level selection in %s',
  (locale, levelBoundary, optionsBoundary) => {
    const policy = callerIntentPolicy(locale);
    expect(policy).toContain(levelBoundary);
    expect(policy).toContain(optionsBoundary);
  },
);

it('does not inject the English routing block into French or Arabic profiles', () => {
  expect(buildAgentProfile('fr').instructions).not.toContain(
    'Authoritative caller-intent routing',
  );
  expect(buildAgentProfile('ar-SA').instructions).not.toContain(
    'Authoritative caller-intent routing',
  );
});
