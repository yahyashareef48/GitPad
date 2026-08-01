import * as vscode from 'vscode';

import type { HostToSidebar, SidebarToHost } from '../../shared/protocol';
import type { VaultController } from '../vault/VaultController';
import { renderWebviewHtml } from '../webview/WebviewHost';

/*
 * Hosts the GitPad sidebar.
 *
 * The sidebar is a webview rather than a native TreeView: a native tree cannot
 * host a search box or a custom "Recently opened" section. The cost is that
 * keyboard navigation, drag-and-drop and context menus become our code -- see
 * plan section 2.2.
 *
 * This class stays thin on purpose. It translates between the webview's
 * messages and the rest of the extension, and owns no state of its own.
 */
export class SidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  /** Must match the view id contributed in package.json. */
  public static readonly viewType = 'gitpad.sidebar';

  private view: vscode.WebviewView | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly vault: VaultController,
  ) {
    this.subscriptions.push(
      this.vault.onDidChangeState((state) => {
        this.post({ type: 'vaultState', state });
      }),
    );
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

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
      void this.handle(message);
    });

    // A hidden sidebar webview is destroyed and rebuilt on reveal, so the
    // reference we post through must be cleared when it goes.
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private async handle(message: SidebarToHost): Promise<void> {
    switch (message.type) {
      case 'ready':
        // Only safe to send state once the webview says it is listening --
        // messages posted to a still-loading webview are dropped silently.
        this.post({ type: 'vaultState', state: this.vault.state });
        break;

      case 'createVault':
        await this.vault.chooseVault('create');
        break;

      case 'openVault':
        await this.vault.chooseVault('open');
        break;
    }
  }

  private post(message: HostToSidebar): void {
    void this.view?.webview.postMessage(message);
  }
}
