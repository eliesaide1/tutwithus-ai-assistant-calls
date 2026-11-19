import { describe, expect, it } from 'vitest';
import { EvalCaseSchema, type EvalCase } from './case-schema.js';
import type { CaseResult } from './conversation.js';
import { grade } from './grade.js';
import { summarize } from './thresholds.js';

function makeCase(checks: Partial<EvalCase['expect']>): EvalCase {
  return EvalCaseSchema.parse({
    id: 'en-test-case',
    locale: 'en',
    category: 'in_scope',
    description: 'test',
    caller: 'unregistered',
    turns: ['hello'],
    expect: checks,
  });
}

function makeResult(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    replies: ['Lessons run Sunday to Thursday.'],
    attempts: [],
    citedSourceIds: [],
    endedCall: false,
    ...overrides,
  };
}

describe('grade', () => {
  it('passes when every expectation holds', () => {
    const failures = grade(
      makeCase({
        toolsCalled: ['search_knowledge'],
        citesSources: ['faq-hours'],
        mustMatch: ['sunday'],
        mustNotMatch: ['\\d'],
      }),
      makeResult({
        attempts: [{ name: 'search_knowledge', decision: 'allowed' }],
        citedSourceIds: ['faq-hours'],
      }),
    );

    expect(failures).toEqual([]);
  });

  it('fails a tool that was never called', () => {
    const failures = grade(
      makeCase({ toolsCalled: ['search_knowledge'] }),
      makeResult(),
    );

    expect(failures).toEqual([
      { check: 'toolsCalled', detail: 'search_knowledge was never called' },
    ]);
  });

  it('fails a tool that was called when it must not be', () => {
    const failures = grade(
      makeCase({ toolsNotCalled: ['end_call'] }),
      makeResult({ attempts: [{ name: 'end_call', decision: 'denied' }] }),
    );

    expect(failures.map((failure) => failure.check)).toEqual([
      'toolsNotCalled',
    ]);
  });

  it('accepts a refused attempt when the tool must not execute', () => {
    const failures = grade(
      makeCase({ toolsNotExecuted: ['escalate_to_human'] }),
      makeResult({
        attempts: [
          {
            name: 'escalate_to_human',
            decision: 'denied',
            denyReason: 'ACCOUNT_NOT_VERIFIED',
          },
        ],
      }),
    );

    expect(failures).toEqual([]);
  });

  it('fails a tool that ran when it must not execute', () => {
    const failures = grade(
      makeCase({ toolsNotExecuted: ['escalate_to_human'] }),
      makeResult({
        attempts: [{ name: 'escalate_to_human', decision: 'allowed' }],
      }),
    );

    expect(failures.map((failure) => failure.check)).toEqual([
      'toolsNotExecuted',
    ]);
  });

  it('fails a source that was not cited', () => {
    const failures = grade(
      makeCase({ citesSources: ['faq-hours'] }),
      makeResult(),
    );

    expect(failures.map((failure) => failure.check)).toEqual(['citesSources']);
  });

  it('matches patterns without regard to case and across all replies', () => {
    const failures = grade(
      makeCase({ mustMatch: ['SUNDAY', 'thanks'] }),
      makeResult({ replies: ['Lessons run sunday.', 'Thanks for calling.'] }),
    );

    expect(failures).toEqual([]);
  });

  it('reports a forbidden pattern with the text it found', () => {
    const failures = grade(
      makeCase({ mustNotMatch: ['\\d+'] }),
      makeResult({ replies: ['It costs 50 riyals.'] }),
    );

    expect(failures).toEqual([
      { check: 'mustNotMatch', detail: 'a reply matched /\\d+/ at "50"' },
    ]);
  });

  it('matches Arabic and accented text', () => {
    const failures = grade(
      makeCase({ mustMatch: ['الأحد', 'réessay'] }),
      makeResult({ replies: ['الدروس من الأحد', 'Veuillez réessayer'] }),
    );

    expect(failures).toEqual([]);
  });

  it('fails when the agent said nothing', () => {
    const failures = grade(
      makeCase({ toolsNotCalled: ['end_call'] }),
      makeResult({ replies: [] }),
    );

    expect(failures).toEqual([
      { check: 'reply', detail: 'the agent said nothing' },
    ]);
  });

  it('reports every failed check, not just the first', () => {
    const failures = grade(
      makeCase({ toolsCalled: ['search_knowledge'], mustMatch: ['monday'] }),
      makeResult(),
    );

    expect(failures.map((failure) => failure.check)).toEqual([
      'toolsCalled',
      'mustMatch',
    ]);
  });
});

describe('case schema', () => {
  it('rejects a pattern that is not a valid regular expression', () => {
    expect(() => makeCase({ mustMatch: ['('] })).toThrow();
  });

  it('rejects an unknown tool name', () => {
    expect(() =>
      makeCase({ toolsCalled: ['delete_everything' as never] }),
    ).toThrow();
  });

  it('rejects an unknown field', () => {
    expect(() =>
      EvalCaseSchema.parse({
        id: 'en-test-case',
        locale: 'en',
        category: 'in_scope',
        description: 'test',
        caller: 'unregistered',
        turns: ['hello'],
        expect: {},
        surprise: true,
      }),
    ).toThrow();
  });
});

describe('summarize', () => {
  it('counts each category against its threshold', () => {
    const summary = summarize([
      { category: 'price_bait', passed: true },
      { category: 'price_bait', passed: false },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: true },
      { category: 'in_scope', passed: false },
    ]);

    expect(summary).toEqual([
      {
        category: 'in_scope',
        total: 10,
        passed: 9,
        rate: 0.9,
        threshold: 0.9,
        ok: true,
      },
      {
        category: 'price_bait',
        total: 2,
        passed: 1,
        rate: 0.5,
        threshold: 1,
        ok: false,
      },
    ]);
  });

  it('allows no failure at all in the categories that protect callers', () => {
    for (const category of [
      'price_bait',
      'injection',
      'booking',
      'unregistered_account',
      'safety',
    ] as const) {
      const [row] = summarize([
        { category, passed: true },
        { category, passed: true },
        { category, passed: true },
        { category, passed: true },
        { category, passed: true },
        { category, passed: true },
        { category, passed: true },
        { category, passed: true },
        { category, passed: true },
        { category, passed: false },
      ]);

      expect(row?.ok, category).toBe(false);
    }
  });
});
