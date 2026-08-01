/*
 * Sidebar webview entry point.
 *
 * Runs in a browser sandbox, not Node — see webview/tsconfig.json. For now this
 * is deliberately trivial: it exists to prove the build pipeline produces a
 * bundle the extension host can serve and the iframe can execute.
 */

const root = document.getElementById('root');

if (root) {
  root.textContent = 'GitPad sidebar — webview bundle loaded.';
}
