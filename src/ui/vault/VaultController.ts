import * as vscode from 'vscode';

import type { Logger } from '../../core/ports/Logger';
import type { VaultLayout } from '../../core/vault/VaultLayout';
import type { VaultService } from '../../core/vault/VaultService';
import { detectVaultCandidate } from '../../core/vault/detectVaultCandidate';
import type { FileSystem } from '../../core/ports/FileSystem';
import type { VaultState } from '../../shared/protocol';

/*
 * Owns "which vault is open", and the flow for choosing one.
 *
 * Sits in ui/ rather than core/ because everything here is a conversation with
 * the user -- folder pickers, warnings, settings. The rules it enforces live in
 * core/vault and are tested without any of this.
 */

const VAULT_PATH_SETTING = 'gitpad.vault.path';

export class VaultController implements vscode.Disposable {
  private readonly stateChanged = new vscode.EventEmitter<VaultState>();
  private layout: VaultLayout | undefined;

  public readonly onDidChangeState = this.stateChanged.event;

  public constructor(
    private readonly fs: FileSystem,
    private readonly vaults: VaultService,
    private readonly logger: Logger,
  ) {}

  public get state(): VaultState {
    return this.layout === undefined
      ? { kind: 'no-vault' }
      : { kind: 'ready', root: this.layout.root };
  }

  /**
   * Opens the configured vault, if there is one.
   *
   * A configured path that no longer exists is treated as "no vault" rather
   * than as an error: the folder may be on a drive that is not mounted yet, and
   * showing the welcome screen is more useful than an error the user cannot act
   * on.
   */
  public async restore(): Promise<void> {
    const configured = vscode.workspace.getConfiguration().get<string>(VAULT_PATH_SETTING);

    if (configured === undefined || configured.trim() === '') {
      return;
    }

    const stat = await this.fs.stat(configured);

    if (stat?.kind !== 'directory') {
      this.logger.warn(`Configured vault is missing: ${configured}`);
      return;
    }

    await this.open(configured);
  }

  /** Welcome screen entry points. Both end in the same place. */
  public async chooseVault(mode: 'create' | 'open'): Promise<void> {
    const folder = await this.pickFolder(mode);

    if (folder === undefined) {
      return;
    }

    const candidate = await detectVaultCandidate(folder, this.fs);

    if (candidate.kind === 'foreign-repo') {
      const consented = await this.confirmForeignRepo(folder, candidate.repoRoot);

      if (!consented) {
        return;
      }

      await this.open(folder, { adoptedForeignRepo: true });
      return;
    }

    await this.open(folder);
  }

  public dispose(): void {
    this.stateChanged.dispose();
  }

  private async pickFolder(mode: 'create' | 'open'): Promise<string | undefined> {
    const chosen = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: mode === 'create' ? 'Choose a folder for your new vault' : 'Open an existing vault',
      openLabel: mode === 'create' ? 'Create vault here' : 'Open vault',
      // Deliberately no defaultUri. Defaulting to the open workspace is how a
      // personal note ends up inside someone's code repo -- see plan 2.1.
    });

    return chosen?.[0]?.fsPath;
  }

  /**
   * Warns before adopting a folder inside someone else's git repository.
   *
   * M1 has no sync, so the only outcome available is "use it, without sync".
   * The consent is still recorded in the vault config, because the sync setup
   * in M5 needs to know this vault was adopted rather than created, and must
   * ask again -- with the stronger confirmation the plan calls for -- before
   * committing anything.
   */
  private async confirmForeignRepo(folder: string, repoRoot: string): Promise<boolean> {
    const useAnyway = 'Use it anyway';

    const choice = await vscode.window.showWarningMessage(
      'That folder is inside a Git repository that is not a GitPad vault.',
      {
        modal: true,
        detail:
          `Repository: ${repoRoot}\n\n` +
          'GitPad will not sync it. If you later turn sync on, GitPad would ' +
          'commit everything in that repository — including your project’s ' +
          'source — every few seconds, so it will ask again first.\n\n' +
          'Choosing a separate folder for your notes avoids this entirely.',
      },
      useAnyway,
    );

    if (choice !== useAnyway) {
      this.logger.info(`Declined to adopt foreign repo at ${repoRoot} for vault ${folder}`);
      return false;
    }

    return true;
  }

  private async open(
    root: string,
    options: { readonly adoptedForeignRepo?: boolean } = {},
  ): Promise<void> {
    this.layout = await this.vaults.initialize(root, options);

    await vscode.workspace
      .getConfiguration()
      .update(VAULT_PATH_SETTING, root, vscode.ConfigurationTarget.Global);

    this.stateChanged.fire(this.state);
  }
}
