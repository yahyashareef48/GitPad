import * as vscode from 'vscode';

/*
 * Builds the HTML shell that every GitPad webview is served from.
 *
 * All webview surfaces (sidebar, editor, settings) share this so the security
 * headers are written once and cannot quietly diverge between surfaces.
 */

export interface WebviewHtmlOptions {
  readonly webview: vscode.Webview;
  readonly extensionUri: vscode.Uri;
  /** Bundle name under dist/webview, without the .js extension. */
  readonly entry: string;
  readonly title: string;
}

/**
 * A fresh random nonce per load. The CSP below allows exactly one inline
 * script tag -- the one carrying this nonce -- so injected markup cannot
 * execute even if something upstream fails to sanitise user content.
 */
function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function renderWebviewHtml(options: WebviewHtmlOptions): string {
  const { webview, extensionUri, entry, title } = options;
  const nonce = createNonce();

  // Local resources must be rewritten to vscode-webview:// URIs; a plain
  // filesystem path will not load inside the iframe.
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', file));

  const scriptUri = asset(`${entry}.js`);
  // esbuild emits a sibling stylesheet for every entry that imports CSS.
  const styleUri = asset(`${entry}.css`);

  /*
   * `default-src 'none'` denies everything, then each source is re-allowed
   * deliberately:
   *
   *   img-src   ... https:  remote images are permitted because notes embed
   *                         external image URLs (uploads are out of scope).
   *                         `https:` only -- never `http:`.
   *   style-src ... 'unsafe-inline'  editor libraries inject styles at
   *                         runtime; nonces cannot cover those.
   *   script-src nonce-only so only our bundle runs.
   *   connect-src 'none'    the webview never talks to the network itself;
   *                         everything goes through the extension host.
   */
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
    `connect-src 'none'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>${title}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
