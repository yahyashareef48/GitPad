import { defineConfig } from 'vitest/config';

/*
 * Unit tests cover src/core and src/types only -- the layers that never import
 * vscode (enforced by eslint.config.mjs). That is what lets them run here, in
 * plain Node, in milliseconds, instead of inside a downloaded VS Code.
 *
 * Anything that genuinely needs the editor running is an integration test
 * instead; see .vscode-test.mjs.
 */
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/editor/**/*.test.ts'],
    environment: 'node',
  },
});
