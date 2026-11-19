import { describe, expect, it } from 'vitest';
import { CATEGORIES, LOCALES } from './case-schema.js';
import { loadCases } from './load-cases.js';
import { PASS_THRESHOLDS } from './thresholds.js';

const cases = loadCases();

describe('golden cases', () => {
  it.each(LOCALES)('has at least 10 cases in %s', (locale) => {
    expect(
      cases.filter((testCase) => testCase.locale === locale).length,
    ).toBeGreaterThanOrEqual(10);
  });

  it.each(LOCALES)('covers every category in %s', (locale) => {
    const present = new Set(
      cases
        .filter((testCase) => testCase.locale === locale)
        .map((testCase) => testCase.category),
    );

    expect([...present].sort()).toEqual([...CATEGORIES].sort());
  });

  it('has the same number of cases in every language', () => {
    const counts = LOCALES.map(
      (locale) => cases.filter((testCase) => testCase.locale === locale).length,
    );

    expect(new Set(counts).size).toBe(1);
  });

  it('has a threshold for every category', () => {
    expect(Object.keys(PASS_THRESHOLDS).sort()).toEqual([...CATEGORIES].sort());
  });

  it('checks something in every case', () => {
    for (const { id, expect: checks } of cases) {
      const count =
        checks.toolsCalled.length +
        checks.toolsNotCalled.length +
        checks.toolsNotExecuted.length +
        checks.citesSources.length +
        checks.mustMatch.length +
        checks.mustNotMatch.length;
      expect(count, id).toBeGreaterThan(0);
    }
  });

  it('gives price-bait cases knowledge with no digits, so a number in a reply is never grounded', () => {
    for (const testCase of cases.filter(
      (item) => item.category === 'price_bait',
    )) {
      for (const passage of testCase.knowledge) {
        expect(passage.content, testCase.id).not.toMatch(/[0-9٠-٩]/u);
      }
      expect(
        testCase.expect.mustNotMatch.some(
          (pattern) => pattern.includes('\\d') || pattern.includes('0-9'),
        ),
        testCase.id,
      ).toBe(true);
    }
  });

  it('keeps protected account actions out of unregistered golden cases', () => {
    const protectedTools = [
      'get_my_bootcamps',
      'get_my_wallet',
      'find_booking_tutors',
      'check_tutor_availability',
      'book_course',
    ] as const;
    for (const testCase of cases.filter(
      (item) => item.caller === 'unregistered',
    )) {
      for (const tool of protectedTools) {
        expect(testCase.expect.toolsCalled, testCase.id).not.toContain(tool);
      }
    }
  });

  it('makes every registered-action case ask for something only a customer may do', () => {
    for (const testCase of cases.filter(
      (item) => item.category === 'registered_action',
    )) {
      const { toolsCalled } = testCase.expect;
      expect(
        toolsCalled.includes('check_tutor_availability') ||
          toolsCalled.includes('find_booking_tutors') ||
          toolsCalled.includes('book_course') ||
          toolsCalled.includes('get_my_bootcamps') ||
          toolsCalled.includes('get_my_wallet'),
        testCase.id,
      ).toBe(true);
    }
  });

  it('plants the secret in no knowledge passage, so a leak can only come from the instructions', () => {
    for (const testCase of cases) {
      for (const passage of testCase.knowledge) {
        expect(passage.content, testCase.id).not.toContain('CANARY');
      }
    }
  });

  it('writes each case in the language of its folder', () => {
    const arabic = /[\u0600-\u06FF]/u;
    for (const testCase of cases.filter((item) => item.locale === 'ar-SA')) {
      expect(testCase.turns.join(' '), testCase.id).toMatch(arabic);
    }
    for (const testCase of cases.filter((item) => item.locale !== 'ar-SA')) {
      expect(testCase.turns.join(' '), testCase.id).not.toMatch(arabic);
    }
  });
});
