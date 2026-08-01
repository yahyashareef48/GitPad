import esbuild from 'esbuild';

/*
 * GitPad builds two completely separate bundles, because they run in two
 * different environments that share nothing but `src/shared/protocol.ts`:
 *
 *   - the extension  → Node.js, inside VS Code's extension host
 *   - the webviews   → a browser sandbox, inside an iframe
 *
 * Mixing them is the classic mistake here: Node APIs are unavailable in a
 * webview, and DOM APIs are unavailable in the extension host. Keeping them as
 * distinct esbuild configs (with distinct tsconfigs) makes that a build error
 * rather than a runtime one.
 */

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const shared = {
  bundle: true,
  // Sourcemaps are for debugging; shipping them bloats the .vsix for no gain.
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const extensionConfig = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  // `vscode` is injected by the extension host at runtime — it is not an npm
  // package and must never be bundled.
  external: ['vscode'],
  target: 'node18',
};

const webviewConfig = {
  ...shared,
  // One entry per webview surface. They are listed explicitly (rather than
  // globbed) so adding a surface is a deliberate act, not an accident.
  entryPoints: {
    sidebar: 'webview/sidebar/main.tsx',
    editor: 'webview/editor/main.tsx',
  },
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  // The automatic runtime means components do not each need to import React.
  jsx: 'automatic',
  // React ships development-only warnings guarded by this; without it the
  // production bundle keeps the whole dev build.
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  // Codicons' stylesheet references its font file. Emitting it as a sibling
  // asset (rather than inlining ~70 kB of base64 into the CSS) keeps the font
  // cacheable and the stylesheet readable.
  loader: { '.ttf': 'file' },
  /*
   * Splitting is OFF, deliberately.
   *
   * Two reasons, either of which would be enough:
   *
   * 1. CSP. A split build has entries `import` a shared chunk, but our
   *    script-src allows scripts by nonce only, and a nonce does not extend to
   *    modules imported by a nonced script. The chunk is simply blocked at
   *    runtime -- a blank webview with an error only visible in devtools.
   *
   * 2. It would not help anyway. Each surface runs in its own iframe with its
   *    own module cache, so a "shared" chunk is fetched once per surface
   *    regardless. Splitting buys nothing here and costs correctness.
   */
  splitting: false,
};

/*
 * Integration tests run inside a real VS Code, so they must be bundled the same
 * way the extension is -- CJS, Node, `vscode` external. Unit tests do not appear
 * here: vitest runs them straight from TypeScript.
 */
const integrationTestConfig = {
  ...shared,
  entryPoints: [
    'test/integration/extension.test.ts',
    'test/integration/filesystem.test.ts',
    'test/integration/settings.test.ts',
    'test/integration/vaultRestore.test.ts',
  ],
  outdir: 'dist/test',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  target: 'node18',
};

async function run() {
  const configs = [extensionConfig, webviewConfig, integrationTestConfig];

  if (watch) {
    const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('[esbuild] watching…');
    return;
  }

  await Promise.all(configs.map((c) => esbuild.build(c)));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
