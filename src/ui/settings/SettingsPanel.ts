import * as vscode from 'vscode';

import type { FileSystem } from '../../core/ports/FileSystem';
import type { Logger } from '../../core/ports/Logger';
import type { SearchIndex } from '../../core/search/SearchIndex';
import type { TrashService } from '../../core/vault/TrashService';
import type { VaultTree } from '../../core/vault/VaultTree';
import type {
  HostToSettings,
  SettingsToHost,
  VaultSummaryDto,
} from '../../shared/protocol';
import { SETTINGS_GROUPS } from '../../shared/settings';
import type { VaultController } from '../vault/VaultController';
import { renderWebviewHtml } from '../webview/WebviewHost';

/*
 * GitPad's settings page.
 *
 * A single panel, revealed rather than duplicated: opening settings twice
 * should bring the existing tab forward, not stack another copy of the same
 * thing.
 *
 * Every value is read from and written to VS Code configuration. This class
 * stores nothing -- that is what keeps this page, VS Code's settings UI and
 * settings.json all showing the same values (plan 5.4).
 */
export class SettingsPanel {
  private static current: SettingsPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly vault: VaultController,
    private readonly tree: VaultTree,
    private readonly trash: TrashService,
    private readonly search: SearchIndex,
    private readonly fs: FileSystem,
    private readonly logger: Logger,
  ) {
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'pad-file.svg');

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
    };

    panel.webview.html = renderWebviewHtml({
      webview: panel.webview,
      extensionUri,
      entry: 'settings',
      title: 'GitPad Settings',
    });

    panel.webview.onDidReceiveMessage((message: SettingsToHost) => {
      void this.handle(message);
    });

    this.disposables.push(
      /*
       * Configuration changed elsewhere -- VS Code's settings UI, or
       * settings.json edited by hand. The page follows, rather than showing a
       * value that is no longer true.
       */
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gitpad')) {
          void this.postState();
        }
      }),
      this.vault.onDidChangeState(() => {
        void this.postState();
      }),
      this.vault.onDidChangeContents(() => {
        void this.postState();
      }),
    );

    panel.onDidDispose(() => {
      this.dispose();
    });
  }

  public static show(
    extensionUri: vscode.Uri,
    vault: VaultController,
    tree: VaultTree,
    trash: TrashService,
    search: SearchIndex,
    fs: FileSystem,
    logger: Logger,
  ): void {
    if (SettingsPanel.current !== undefined) {
      SettingsPanel.current.panel.reveal();

      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gitpad.settings',
      'GitPad Settings',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    SettingsPanel.current = new SettingsPanel(
      panel,
      extensionUri,
      vault,
      tree,
      trash,
      search,
      fs,
      logger,
    );
  }

  private dispose(): void {
    SettingsPanel.current = undefined;

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handle(message: SettingsToHost): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.postState();
        break;

      case 'set':
        await this.set(message.key, message.value);
        break;

      case 'action':
        await this.act(message.action);
        break;
    }
  }

  private async set(key: string, value: string | number | boolean): Promise<void> {
    // Only keys the page declares are writable, so a malformed message cannot
    // set arbitrary VS Code configuration.
    const known = SETTINGS_GROUPS.flatMap((group) => group.settings).some(
      (setting) => setting.key === key,
    );

    if (!known) {
      this.logger.warn(`Refused to write unknown setting ${key}`);

      return;
    }

    try {
      await vscode.workspace
        .getConfiguration()
        .update(key, value, vscode.ConfigurationTarget.Global);
    } catch (error) {
      this.logger.error(`Could not write ${key}`, error);
    }

    // Echoed back so the page shows what was actually stored, including any
    // value VS Code rejected or coerced.
    await this.postState();
  }

  private async act(action: string): Promise<void> {
    const layout = this.vault.currentLayout;

    switch (action) {
      case 'changeVault':
        await this.vault.chooseVault('open');
        break;

      case 'revealVault':
        if (layout !== undefined) {
          await vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(layout.root),
          );
        }
        break;

      case 'emptyTrash':
        if (layout !== undefined) {
          const count = (await this.trash.list(layout)).length;
          const confirm = `Delete ${count} item${count === 1 ? '' : 's'}`;

          const choice = await vscode.window.showWarningMessage(
            'Empty the trash?',
            { modal: true, detail: 'This cannot be undone.' },
            confirm,
          );

          if (choice === confirm) {
            await this.trash.empty(layout);
            await this.postState();
          }
        }
        break;

      case 'rebuildSearch':
        if (layout !== undefined) {
          await this.search.build(layout.root);
          void vscode.window.showInformationMessage('Search index rebuilt.');
        }
        break;

      case 'openVsCodeSettings':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:YahyaShareef.gitpad',
        );
        break;

      default:
        this.logger.warn(`Unknown settings action: ${action}`);
    }
  }

  private async postState(): Promise<void> {
    const configuration = vscode.workspace.getConfiguration();
    const values: Record<string, string | number | boolean> = {};

    for (const group of SETTINGS_GROUPS) {
      for (const setting of group.settings) {
        const value = configuration.get<string | number | boolean>(setting.key);

        if (value !== undefined) {
          values[setting.key] = value;
        }
      }
    }

    void this.panel.webview.postMessage({
      type: 'state',
      values,
      vault: await this.summarise(),
    } satisfies HostToSettings);
  }

  /** Counts and sizes the vault. Undefined when none is open. */
  private async summarise(): Promise<VaultSummaryDto | undefined> {
    const layout = this.vault.currentLayout;

    if (layout === undefined) {
      return undefined;
    }

    try {
      const files = collectPaths(await this.tree.build(layout.root));
      let sizeBytes = 0;

      for (const file of files) {
        sizeBytes += (await this.fs.stat(file))?.size ?? 0;
      }

      return {
        root: layout.root,
        noteCount: files.length,
        trashCount: (await this.trash.list(layout)).length,
        sizeBytes,
      };
    } catch (error) {
      // A summary is informational; failing to compute it must not blank the
      // page or stop settings being editable.
      this.logger.warn('Could not summarise the vault', error);

      return { root: layout.root, noteCount: 0, trashCount: 0, sizeBytes: 0 };
    }
  }
}

function collectPaths(
  nodes: readonly { id: string; children?: readonly unknown[] }[],
): readonly string[] {
  const paths: string[] = [];

  const walk = (list: readonly { id: string; children?: readonly unknown[] }[]): void => {
    for (const node of list) {
      if (node.children === undefined) {
        paths.push(node.id);
      } else {
        walk(node.children as readonly { id: string; children?: readonly unknown[] }[]);
      }
    }
  };

  walk(nodes);

  return paths;
}
