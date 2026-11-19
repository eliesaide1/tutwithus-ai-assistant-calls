import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TRANSPORTS = ['browser', 'whatsapp-sip'];
const transportBoundaries = TRANSPORTS.map((transport) => ({
  files: [`apps/api/src/transports/${transport}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: TRANSPORTS.filter((other) => other !== transport).map(
          (other) => ({
            regex: `(^|/)${other}(/|$)`,
            message: `Transports must not import each other. Share code through core/ instead of importing transports/${other}.`,
          }),
        ),
      },
    ],
  },
}));

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    'apps/api/openapi/**',
    'evals/reports/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{ts,mts,js,mjs}'],
    ignores: ['apps/web/src/**', 'apps/whatsapp-console/src/**'],
    languageOptions: { globals: globals.node },
  },
  ...[
    'apps/web/src/**/*.{ts,tsx}',
    'apps/whatsapp-console/src/**/*.{ts,tsx}',
  ].map((files) => ({
    files: [files],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  })),
  {
    files: ['apps/api/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)(transports|http)(/|$)',
              message:
                'core/ must stay transport-independent: do not import transports/ or http/.',
            },
            {
              regex:
                '(^|/)modules/[^/]+/[^/]+\\.(routes|repository|model)(\\.js)?$',
              message:
                'core/ must call a module service, not its routes, repository or model.',
            },
          ],
        },
      ],
    },
  },
  ...transportBoundaries,
  {
    files: ['apps/api/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./[^./][^/]*/[^/]+\\.(repository|model)(\\.js)?$',
              message:
                "Do not import another module's repository or model. Call that module's service instead.",
            },
          ],
        },
      ],
    },
  },
]);
