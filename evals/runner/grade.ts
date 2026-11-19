import type { EvalCase } from './case-schema.js';
import type { CaseResult } from './conversation.js';

export type Failure = { check: string; detail: string };

// Compares what happened in a case with what the case expects. Returns every
// failed check, so one run shows all the problems at once.
export function grade(testCase: EvalCase, result: CaseResult): Failure[] {
  const failures: Failure[] = [];
  const { expect } = testCase;
  const tried = new Set(result.attempts.map((attempt) => attempt.name));
  const ran = new Set(
    result.attempts
      .filter((attempt) => attempt.decision === 'allowed')
      .map((attempt) => attempt.name),
  );
  const said = result.replies.join('\n');

  for (const name of expect.toolsCalled) {
    if (!tried.has(name)) {
      failures.push({
        check: 'toolsCalled',
        detail: `${name} was never called`,
      });
    }
  }
  for (const name of expect.toolsNotCalled) {
    if (tried.has(name)) {
      failures.push({ check: 'toolsNotCalled', detail: `${name} was called` });
    }
  }
  for (const name of expect.toolsNotExecuted) {
    if (ran.has(name)) {
      failures.push({ check: 'toolsNotExecuted', detail: `${name} ran` });
    }
  }
  for (const sourceId of expect.citesSources) {
    if (!result.citedSourceIds.includes(sourceId)) {
      failures.push({
        check: 'citesSources',
        detail: `${sourceId} was not cited`,
      });
    }
  }
  for (const pattern of expect.mustMatch) {
    if (!new RegExp(pattern, 'iu').test(said)) {
      failures.push({
        check: 'mustMatch',
        detail: `no reply matched /${pattern}/`,
      });
    }
  }
  for (const pattern of expect.mustNotMatch) {
    const match = new RegExp(pattern, 'iu').exec(said);
    if (match) {
      failures.push({
        check: 'mustNotMatch',
        detail: `a reply matched /${pattern}/ at "${match[0]}"`,
      });
    }
  }
  if (result.replies.length === 0) {
    failures.push({ check: 'reply', detail: 'the agent said nothing' });
  }
  return failures;
}
