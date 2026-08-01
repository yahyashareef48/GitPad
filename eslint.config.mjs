import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/*
 * The important rule in this file is the architectural boundary at the bottom.
 *
 * The plan's layering (section 1.1) only holds if it is enforced. A rule people
 * have to remember is a rule that gets broken in month three, by which point
 * unpicking it is expensive; a rule that fails the build is not.
 */
export default tseslint.config(
  {
    // .vscode-test holds a full VS Code install (~320 MB) downloaded by the
    // integration harness. It appears only after `npm run test:integration`
    // has run once, so forgetting it here fails long after the config looked
    // fine.
    ignores: ['dist/**', 'out/**', 'node_modules/**', '.vscode-test/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Unused values are usually a leftover or a mistake, but an underscore
      // prefix is an explicit "yes, I know" for required-but-unused params.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Prefer `import type` so type-only imports are erased at build time and
      // cannot accidentally pull a runtime module across a boundary.
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },

  {
    // ---- The architectural boundary ----
    //
    // core/ and types/ are the domain layer. They must stay runnable in plain
    // Node so their tests need no extension host, and they must not know which
    // editor they are embedded in.
    files: ['src/core/**/*.ts', 'src/types/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'The domain layer must not import vscode. Add a port in core/ports and implement it in platform/ instead — see plan section 1.1.',
            },
          ],
          patterns: [
            {
              group: ['**/platform/**', '**/ui/**', '**/sync/**'],
              message:
                'The domain layer must not depend on outer layers. Dependencies point inward only — see plan section 1.1.',
            },
          ],
        },
      ],
    },
  },

  {
    // Build scripts and configs are Node scripts, not extension source.
    files: ['*.mjs', '*.config.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
