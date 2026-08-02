import * as vscode from 'vscode';

import { LinkIndex } from './core/links/LinkIndex';
import { LinkRenamer } from './core/links/LinkRenamer';
import { OrderService } from './core/ordering/OrderService';
import { SearchIndex } from './core/search/SearchIndex';
import { NoteService } from './core/vault/NoteService';
import { NOTE_EXTENSION } from './core/vault/VaultLayout';
import { TrashService } from './core/vault/TrashService';
import { VaultService } from './core/vault/VaultService';
import { VaultTree } from './core/vault/VaultTree';
import { OutputChannelLogger } from './platform/OutputChannelLogger';
import { SystemClock } from './platform/SystemClock';
import { VsCodeFileSystem } from './platform/VsCodeFileSystem';
import { AutoSave } from './ui/editor/AutoSave';
import { PadEditorProvider } from './ui/editor/PadEditorProvider';
import { searchNotes } from './ui/search/searchNotes';
import { SettingsPanel } from './ui/settings/SettingsPanel';
import { SidebarViewProvider } from './ui/sidebar/SidebarViewProvider';
import { RecentlyOpened } from './ui/vault/RecentlyOpened';
import { VaultController } from './ui/vault/VaultController';

/*
 * Activation does wiring and nothing else -- no logic lives here.
 *
 * This is the one place that knows which implementation satisfies which port,
 * which is what keeps the rest of the codebase depending on interfaces.
 *
 * GitPad activates on `onStartupFinished` rather than lazily on first view,
 * because sync needs to pull changes from other devices before the user looks
 * at the sidebar. That only stays affordable if activation itself is cheap:
 * webview bundles load when a surface is first revealed, and the sync layer is
 * not imported at all while sync is off.
 */
export function activate(context: vscode.ExtensionContext): void {
  const logger = new OutputChannelLogger();
  const fs = new VsCodeFileSystem();
  const clock = new SystemClock();

  const vaults = new VaultService(fs, clock, logger);
  const vault = new VaultController(fs, vaults, logger);

  // Extensions the tree should show. Becomes the DocumentTypeRegistry's
  // registered extensions in Phase 3; a hardcoded set until there is more than
  // one type to register.
  const tree = new VaultTree(fs, logger, new Set([NOTE_EXTENSION]));
  const notes = new NoteService(fs, clock, logger);

  // Read on every use, not captured here -- see RecentlyOpened's constructor.
  const recent = new RecentlyOpened(context.globalState, () =>
    vscode.workspace.getConfiguration().get<number>('gitpad.sidebar.recentlyOpenedCount', 5),
  );

  const order = new OrderService(fs, logger);
  const links = new LinkIndex(fs, logger, new Set([NOTE_EXTENSION]));
  const trash = new TrashService(fs, clock, logger);
  const renamer = new LinkRenamer(fs, logger, new Set([NOTE_EXTENSION]));
  const search = new SearchIndex(fs, logger, new Set([NOTE_EXTENSION]));

  const sidebar = new SidebarViewProvider(
    context.extensionUri,
    vault,
    tree,
    notes,
    recent,
    order,
    links,
    trash,
    renamer,
    logger,
  );

  const autoSave = new AutoSave(logger);
  const editor = new PadEditorProvider(
    context.extensionUri,
    fs,
    autoSave,
    clock,
    notes,
    vault,
    renamer,
    logger,
  );

  context.subscriptions.push(
    logger,
    vault,
    sidebar,
    autoSave,
    editor,
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebar),
    vscode.window.registerCustomEditorProvider(PadEditorProvider.viewType, editor, {
      // Kept alive while hidden so switching tabs does not discard the
      // webview and re-run its startup. Notes are small; the memory cost is
      // not.
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('gitpad.createVault', () => vault.chooseVault('create')),
    vscode.commands.registerCommand('gitpad.openVault', () => vault.chooseVault('open')),
    vscode.commands.registerCommand('gitpad.searchNotes', () => searchNotes(vault, search, logger)),
    vscode.commands.registerCommand('gitpad.openSettings', () => {
      SettingsPanel.show(context.extensionUri, vault, tree, trash, search, fs, logger);
    }),
  );

  // Not awaited: activation should not block on disk. The sidebar renders its
  // loading state and updates when this resolves.
  void vault.restore().catch((error: unknown) => {
    logger.error('Failed to restore the configured vault', error);
  });

  logger.info('GitPad activated.');
}

export function deactivate(): void {
  // Nothing to tear down: everything is registered through context.subscriptions.
}
