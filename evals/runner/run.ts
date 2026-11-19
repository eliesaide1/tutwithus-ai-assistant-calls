import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCase } from './conversation.js';
import { grade, type Failure } from './grade.js';
import { loadCases } from './load-cases.js';
import { OpenAIEvalModel } from './model.js';
import { summarize } from './thresholds.js';

// Runs the golden cases against a real model and exits non-zero if any
// category falls under its threshold.
//
//   corepack pnpm eval                      every case
//   corepack pnpm eval -- --locale en       one language
//   corepack pnpm eval -- --id en-price-bait-rough
//
// Needs OPENAI_API_KEY. EVAL_MODEL picks the model (default gpt-4o-mini).

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error(
    'OPENAI_API_KEY is not set. Set it in .env to run the evaluation.',
  );
  process.exit(2);
}
const modelName = process.env.EVAL_MODEL ?? 'gpt-4o-mini';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const onlyLocale = option('locale');
const onlyId = option('id');

const cases = loadCases().filter(
  (testCase) =>
    (!onlyLocale || testCase.locale === onlyLocale) &&
    (!onlyId || testCase.id === onlyId),
);
if (cases.length === 0) {
  console.error('No cases match the filters.');
  process.exit(2);
}

type RunResult = {
  id: string;
  locale: string;
  category: (typeof cases)[number]['category'];
  passed: boolean;
  failures: Failure[];
  replies: string[];
};

const model = new OpenAIEvalModel(apiKey, modelName);
const results: RunResult[] = [];

for (const testCase of cases) {
  const base = {
    id: testCase.id,
    locale: testCase.locale,
    category: testCase.category,
  };
  let result: RunResult;
  try {
    const outcome = await runCase(testCase, model);
    const failures = grade(testCase, outcome);
    result = {
      ...base,
      passed: failures.length === 0,
      failures,
      replies: outcome.replies,
    };
  } catch (error) {
    result = {
      ...base,
      passed: false,
      failures: [
        {
          check: 'run',
          detail: error instanceof Error ? error.name : 'UnknownError',
        },
      ],
      replies: [],
    };
  }
  results.push(result);
  console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.id}`);
  for (const failure of result.failures) {
    console.log(`        ${failure.check}: ${failure.detail}`);
  }
}

const summary = summarize(results);
console.log('\nCategory            passed  rate   needs');
for (const row of summary) {
  console.log(
    `${row.category.padEnd(21)}${`${row.passed}/${row.total}`.padEnd(8)}${`${Math.round(row.rate * 100)}%`.padEnd(7)}${Math.round(row.threshold * 100)}%  ${row.ok ? 'ok' : 'BELOW THRESHOLD'}`,
  );
}

const reportsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'reports',
);
mkdirSync(reportsDir, { recursive: true });
const reportPath = join(
  reportsDir,
  `eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
writeFileSync(
  reportPath,
  JSON.stringify({ model: modelName, summary, results }, null, 2),
);
console.log(`\nReport: ${reportPath}`);

process.exit(summary.every((row) => row.ok) ? 0 : 1);
