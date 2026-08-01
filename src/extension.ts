import * as vscode from 'vscode';

import { OutputChannelLogger } from './platform/OutputChannelLogger';
import { SidebarViewProvider } from './ui/sidebar/SidebarViewProvider';

/*
 * Activation does wiring and nothing else -- no logic lives here.
 *
 * GitPad activates on `onStartupFinished` rather than lazily on first view,
 * because sync needs to pull changes from other devices before the user looks
 * at the sidebar. That only stays affordable if activation itself is cheap:
 * webview bundles load when a surface is first revealed, and the sync layer is
 * not imported at all while sync is off.
 */
export function activate(context: vscode.ExtensionContext): void {
  const logger = new OutputChannelLogger();
  context.subscriptions.push(logger);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarViewProvider.viewType,
      new SidebarViewProvider(context.extensionUri),
    ),
  );

  logger.info('GitPad activated.');
}

export function deactivate(): void {
  // Nothing to tear down: everything is registered through context.subscriptions.
}
