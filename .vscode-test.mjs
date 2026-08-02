import { defineConfig } from '@vscode/test-cli';

/*
 * Integration tests: the small set of things that genuinely need a running
 * VS Code -- activation, contributed views, custom editors, commands.
 *
 * Everything that can be tested without an editor should be a vitest unit test
 * instead (vitest.config.mts). This suite downloads and boots VS Code, so it is
 * seconds where vitest is milliseconds; keeping it small keeps it useful.
 */
export default defineConfig({
  files: 'dist/test/**/*.test.js',
  mocha: {
    // Stated explicitly rather than relied upon, so the test files' style
    // cannot drift from the runner's expectations.
    ui: 'bdd',
    timeout: 20_000,
  },
});
