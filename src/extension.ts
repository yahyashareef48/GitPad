import * as vscode from 'vscode';

import { NoteService } from './core/vault/NoteService';
import { NOTE_EXTENSION } from './core/vault/VaultLayout';
import { VaultService } from './core/vault/VaultService';
import { VaultTree } from './core/vault/VaultTree';
import { OutputChannelLogger } from './platform/OutputChannelLogger';
import { SystemClock } from './platform/SystemClock';
import { VsCodeFileSystem } from './platform/VsCodeFileSystem';
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

  const recentLimit = vscode.workspace
    .getConfiguration()
    .get<number>('gitpad.sidebar.recentlyOpenedCount', 5);
  const recent = new RecentlyOpened(context.globalState, recentLimit);

  const sidebar = new SidebarViewProvider(
    context.extensionUri,
    vault,
    tree,
    notes,
    recent,
    logger,
  );

  context.subscriptions.push(
    logger,
    vault,
    sidebar,
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebar),
    vscode.commands.registerCommand('gitpad.createVault', () => vault.chooseVault('create')),
    vscode.commands.registerCommand('gitpad.openVault', () => vault.chooseVault('open')),
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
