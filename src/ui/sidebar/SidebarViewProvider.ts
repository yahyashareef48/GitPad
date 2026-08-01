import * as path from 'node:path';

import * as vscode from 'vscode';

import type { LinkGraph, LinkIndex } from '../../core/links/LinkIndex';
import type { OrderService } from '../../core/ordering/OrderService';
import type { Logger } from '../../core/ports/Logger';
import type { NoteService } from '../../core/vault/NoteService';
import type { VaultLayout } from '../../core/vault/VaultLayout';
import type { VaultTree } from '../../core/vault/VaultTree';
import type { HostToSidebar, SidebarToHost } from '../../shared/protocol';
import { PadEditorProvider } from '../editor/PadEditorProvider';
import type { RecentlyOpened } from '../vault/RecentlyOpened';
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

  /** Rebuilt with the tree; undefined until the first scan finishes. */
  private graph: LinkGraph | undefined;

  /**
   * Every note path the last scan found.
   *
   * Used to prune recents. Deriving it from the tree rather than checking
   * the disk means one source of truth and no extra IO -- and it catches a
   * note deleted outside GitPad just as well as one deleted inside it.
   */
  private knownPaths = new Set<string>();
  private readonly subscriptions: vscode.Disposable[] = [];

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly vault: VaultController,
    private readonly tree: VaultTree,
    private readonly notes: NoteService,
    private readonly recent: RecentlyOpened,
    private readonly order: OrderService,
    private readonly links: LinkIndex,
    private readonly logger: Logger,
  ) {
    this.subscriptions.push(
      this.vault.onDidChangeState((state) => {
        this.post({ type: 'vaultState', state });
        this.postRecent();
        void this.refreshTree();
      }),
      this.vault.onDidChangeContents(() => {
        void this.refreshTree();
      }),
      // Backlinks follow the active tab, so switching notes updates them.
      vscode.window.tabGroups.onDidChangeTabs(() => {
        this.postBacklinks();
      }),
      // Settings changes must take effect immediately. Requiring a reload to
      // see the result of a checkbox reads as the setting not working.
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gitpad.sidebar')) {
          this.postRecent();
        }
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
        this.postRecent();
        this.postBacklinks();
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

      case 'createNote':
        await this.withVault(async (layout) => {
          const created = await this.notes.createNote(layout, message.parentId ?? layout.root);

          await this.refreshTree();
          // Opened immediately: a new note you cannot type into is not much
          // use, and this is the point where naming it makes sense.
          await this.openDocument(created);
        });
        break;

      case 'createFolder':
        await this.withVault(async (layout) => {
          await this.notes.createFolder(layout, message.parentId ?? layout.root);
          await this.refreshTree();
        });
        break;

      case 'renameItem':
        await this.rename(message.id, message.currentName);
        break;

      case 'duplicateItem':
        await this.withVault(async (layout) => {
          await this.notes.duplicate(layout, message.id);
          await this.refreshTree();
        });
        break;

      case 'trashItem':
        await this.trash(message.id, message.name);
        break;

      case 'moveItem':
        await this.move(message.id, message.parentId, message.index);
        break;

      case 'openSettings':
        // Stand-in until the dedicated settings page lands in M4. Filtering by
        // extension id gives GitPad's settings and nothing else.
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:YahyaShareef.gitpad',
        );
        break;
    }
  }

  /**
   * Applies a drag: move the file if the folder changed, then record the new
   * position within the destination folder.
   *
   * Order is recorded from the destination's contents AFTER the move, read
   * from disk rather than from the tree the webview held. The webview's copy
   * predates the move and would put the item back where it came from.
   */
  private async move(id: string, parentId: string | undefined, index: number): Promise<void> {
    await this.withVault(async (layout) => {
      const destination = parentId ?? layout.root;
      const moved = await this.notes.move(layout, id, destination);

      const siblings = (await this.tree.build(destination)).map((node) =>
        path.basename(node.id),
      );

      await this.order.reorder(destination, siblings, path.basename(moved), index);
      await this.refreshTree();
    });
  }

  private async rename(id: string, currentName: string): Promise<void> {
    const title = await vscode.window.showInputBox({
      title: 'Rename',
      value: currentName,
      // Preselects the name so typing replaces it, but leaves the caret
      // placeable for a small edit.
      valueSelection: [0, currentName.length],
      prompt: 'The title is the filename, so unsupported characters are replaced.',
    });

    if (title === undefined || title.trim() === '') {
      return;
    }

    await this.withVault(async (layout) => {
      await this.notes.rename(layout, id, title);
      await this.refreshTree();
    });
  }

  /**
   * Deletes without a confirmation prompt.
   *
   * The item goes to `.trash/` and stays recoverable, so a modal would be
   * friction guarding an action that is already reversible. The notification
   * is the confirmation, and it carries the undo.
   */
  private async trash(id: string, name: string): Promise<void> {
    await this.withVault(async (layout) => {
      const trashed = await this.notes.moveToTrash(layout, id);

      await this.refreshTree();

      const undo = 'Undo';
      const choice = await vscode.window.showInformationMessage(`Deleted “${name}”.`, undo);

      if (choice === undo) {
        await this.fsRename(trashed, id);
        await this.refreshTree();
      }
    });
  }

  private async fsRename(from: string, to: string): Promise<void> {
    await vscode.workspace.fs.rename(vscode.Uri.file(from), vscode.Uri.file(to), {
      overwrite: false,
    });
  }

  /**
   * Runs an operation against the open vault, reporting failures visibly.
   *
   * File operations fail for ordinary reasons -- a file locked by another
   * program, a permission problem, a disconnected drive -- and a silent
   * no-op reads as GitPad being broken.
   */
  private async withVault(operation: (layout: VaultLayout) => Promise<void>): Promise<void> {
    const layout = this.vault.currentLayout;

    if (layout === undefined) {
      return;
    }

    try {
      await operation(layout);
    } catch (error) {
      this.logger.error('Vault operation failed', error);

      vscode.window.showErrorMessage(
        error instanceof Error ? error.message : 'The operation failed.',
      );
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
      // Opened through the custom editor rather than as a text document, so
      // clicking a note gives GitPad's editor. `vscode.openWith` names the
      // view type explicitly instead of relying on the default association.
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(id),
        PadEditorProvider.viewType,
      );

      await this.recent.record(id);
      this.postRecent();
    } catch (error) {
      this.logger.error(`Could not open ${id}`, error);

      // A recent entry pointing at a file that is gone is worse than no entry:
      // it offers an action that cannot work. Drop it so the list self-heals.
      await this.recent.forget(id);
      this.postRecent();

      vscode.window.showErrorMessage(`Could not open “${vscode.Uri.file(id).path}”.`);
    }
  }

  /**
   * Pushes backlinks for whichever note is in the active tab.
   *
   * Always sent, including when empty -- otherwise the panel would keep
   * showing one note's backlinks while a different note is open.
   */
  private postBacklinks(): void {
    const active = this.activeNotePath();
    const sources = active === undefined ? [] : (this.graph?.backward.get(active) ?? []);

    this.post({
      type: 'backlinks',
      items: sources.map((id) => ({ id, name: path.parse(id).name })),
    });
  }

  /** The `.pad` file in the active tab, if the active tab is one. */
  private activeNotePath(): string | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input: unknown = tab?.input;

    // Custom editor tabs carry a TabInputCustom, whose `uri` is the file.
    if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
      return input.uri.fsPath;
    }

    return undefined;
  }

  private postRecent(): void {
    const state = this.vault.state;

    const items =
      state.kind === 'ready'
        ? this.recent
            .list(state.root)
            // Before the first scan completes knownPaths is empty; showing
            // the stored list then is better than blanking the section.
            .filter((item) => this.knownPaths.size === 0 || this.knownPaths.has(item.id))
        : [];

    this.post({ type: 'recentlyOpened', items });
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

      // Rebuilt alongside the tree: both derive from the same scan, and a
      // graph older than the tree would show backlinks for deleted notes.
      this.graph = await this.links.build(state.root);
      this.knownPaths = collectPaths(nodes);
      this.postBacklinks();
      // Recents are pruned against the fresh scan, so a deleted note stops
      // being offered rather than lingering as a dead entry.
      this.postRecent();

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

/** Flattens tree nodes to the set of document paths they contain. */
function collectPaths(nodes: readonly { id: string; children?: readonly unknown[] }[]): Set<string> {
  const paths = new Set<string>();

  const walk = (list: readonly { id: string; children?: readonly unknown[] }[]): void => {
    for (const node of list) {
      if (node.children === undefined) {
        paths.add(node.id);
      } else {
        walk(node.children as readonly { id: string; children?: readonly unknown[] }[]);
      }
    }
  };

  walk(nodes);

  return paths;
}
