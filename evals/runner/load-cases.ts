import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { EvalCaseSchema, LOCALES, type EvalCase } from './case-schema.js';

const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'golden',
);

// Reads every evals/golden/<locale>/*.json file. A file holds an array of
// cases. A case in the wrong folder, or a duplicate ID, is an error.
export function loadCases(directory: string = GOLDEN_DIR): EvalCase[] {
  const cases: EvalCase[] = [];
  const seen = new Set<string>();

  for (const locale of LOCALES) {
    const folder = join(directory, locale);
    for (const file of readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .sort()) {
      const parsed = z
        .array(EvalCaseSchema)
        .safeParse(JSON.parse(readFileSync(join(folder, file), 'utf8')));
      if (!parsed.success) {
        throw new Error(
          `${locale}/${file}: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      }
      for (const testCase of parsed.data) {
        if (testCase.locale !== locale) {
          throw new Error(
            `${testCase.id} is in the ${locale} folder but is ${testCase.locale}.`,
          );
        }
        if (seen.has(testCase.id)) {
          throw new Error(`Duplicate case ID: ${testCase.id}`);
        }
        seen.add(testCase.id);
        cases.push(testCase);
      }
    }
  }
  return cases;
}
