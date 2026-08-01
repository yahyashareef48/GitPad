import * as vscode from 'vscode';

import type { Logger } from '../../core/ports/Logger';
import type { VaultTree } from '../../core/vault/VaultTree';
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
    private readonly tree: VaultTree,
    private readonly logger: Logger,
  ) {
    this.subscriptions.push(
      this.vault.onDidChangeState((state) => {
        this.post({ type: 'vaultState', state });
        void this.refreshTree();
      }),
      this.vault.onDidChangeContents(() => {
        void this.refreshTree();
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
        await this.refreshTree();
        break;

      case 'createVault':
        await this.vault.chooseVault('create');
        break;

      case 'openVault':
        await this.vault.chooseVault('open');
        break;

      case 'openDocument':
        await this.openDocument(message.id);
        break;
    }
  }

  /**
   * Opens a note in an editor tab.
   *
   * Until the custom editor lands in M2 this is VS Code's plain text editor,
   * which is genuinely useful in the meantime: it shows that `.pad` files are
   * ordinary markdown, readable without GitPad.
   */
  private async openDocument(id: string): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(id));

      await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) {
      this.logger.error(`Could not open ${id}`, error);
    }
  }

  private async refreshTree(): Promise<void> {
    const state = this.vault.state;

    if (state.kind !== 'ready') {
      // Covers 'loading' and 'no-vault' alike: there is nothing to show, and
      // an empty tree is correct for both.
      this.post({ type: 'tree', nodes: [] });
      return;
    }

    try {
      const nodes = await this.tree.build(state.root);

      // Logged at info because "the sidebar looks empty" is answerable from
      // here: either the scan found nothing (a filter or path problem) or it
      // found something and the fault is in rendering.
      this.logger.info(`Tree built for ${state.root}: ${nodes.length} top-level entries`);

      this.post({ type: 'tree', nodes });
    } catch (error) {
      // A vault on an unmounted drive, or one deleted while open. Log it and
      // leave the previous tree on screen rather than blanking the sidebar.
      this.logger.error(`Could not read the vault at ${state.root}`, error);
    }
  }

  private post(message: HostToSidebar): void {
    if (this.view === undefined) {
      // Not a failure: the sidebar is destroyed while hidden and asks for
      // everything again on reveal. Logged because a message vanishing here
      // otherwise looks identical to one that was never sent.
      this.logger.debug(`Dropped ${message.type}: sidebar not resolved`);
      return;
    }

    void this.view.webview.postMessage(message);
  }
}
