// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next';
import prettier from 'eslint-config-prettier';

const TS_FILES = ['**/*.ts', '**/*.tsx'];

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/generated/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
    ],
  },

  js.configs.recommended,

  // Next-Regeln (React, Hooks, a11y) — nur fuer Anwendungscode.
  ...next,

  // --- Typgestuetztes Linting ausschliesslich fuer TypeScript-Dateien ---
  {
    files: TS_FILES,
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- Kernregel des Projekts: keine Typ-Fluchtwege ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': false, 'ts-ignore': true, 'ts-nocheck': true },
      ],

      // --- Konsistenz ---
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },

  // --- Architekturregel: die Domaene kennt weder LLM noch HTTP noch DB ---
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@google/genai',
                '@anthropic-ai/*',
                'openai',
                '@prisma/client',
                'next',
                'next/*',
                '@trpc/*',
                '**/server/**',
                '**/adapters/**',
              ],
              message:
                'Die Domaene muss frei von Infrastruktur bleiben (siehe AGENTS.md). Nutze Ports statt konkreter Implementierungen.',
            },
          ],
        },
      ],
    },
  },

  // --- Testdateien duerfen pragmatischer sein ---
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // --- Konfigurations- und Skriptdateien: kein Typprojekt vorhanden ---
  {
    files: ['*.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
  },

  prettier,
);
