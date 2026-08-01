import * as vscode from 'vscode';

import type { HostToSidebar, SidebarToHost } from '../../shared/protocol';
import { renderWebviewHtml } from '../webview/WebviewHost';

/*
 * Hosts the GitPad sidebar.
 *
 * The sidebar is a webview rather than a native TreeView: a native tree cannot
 * host a search box or a custom "Recently opened" section. The cost is that
 * keyboard navigation, drag-and-drop and context menus become our code -- see
 * plan section 2.2.
 *
 * This class stays thin on purpose. It owns the webview lifecycle and nothing
 * else; tree data, ordering and file operations belong in core/ and arrive
 * here over the protocol in M1.
 */
export class SidebarViewProvider implements vscode.WebviewViewProvider {
  /** Must match the view id contributed in package.json. */
  public static readonly viewType = 'gitpad.sidebar';

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      // Nothing outside our own bundle directory is loadable. Widening this
      // later (for vault assets) should be a deliberate, reviewed change.
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };

    view.webview.html = renderWebviewHtml({
      webview: view.webview,
      extensionUri: this.extensionUri,
      entry: 'sidebar',
      title: 'GitPad',
    });

    view.webview.onDidReceiveMessage((message: SidebarToHost) => {
      switch (message.type) {
        case 'ready':
          // Only safe to send state once the webview says it is listening --
          // messages posted to a still-loading webview are dropped silently.
          this.post(view.webview, {
            type: 'init',
            text: 'GitPad sidebar — host and webview connected.',
          });
          break;
      }
    });
  }

  private post(webview: vscode.Webview, message: HostToSidebar): void {
    void webview.postMessage(message);
  }
}
