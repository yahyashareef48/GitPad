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
  private readonly contentsChanged = new vscode.EventEmitter<void>();
  private layout: VaultLayout | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  /** False until restore() has finished, however it finished. */
  private restored = false;

  /** Fires when a different vault is opened. */
  public readonly onDidChangeState = this.stateChanged.event;

  /** Fires when files inside the current vault change, from any source. */
  public readonly onDidChangeContents = this.contentsChanged.event;

  public constructor(
    private readonly fs: FileSystem,
    private readonly vaults: VaultService,
    private readonly logger: Logger,
  ) {}

  /** The open vault's paths, or undefined when none is open. */
  public get currentLayout(): VaultLayout | undefined {
    return this.layout;
  }

  public get state(): VaultState {
    if (this.layout !== undefined) {
      return { kind: 'ready', root: this.layout.root };
    }

    // "Not checked yet" is not "no vault". See VaultState in the protocol.
    return this.restored ? { kind: 'no-vault' } : { kind: 'loading' };
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
    try {
      const configured = vscode.workspace.getConfiguration().get<string>(VAULT_PATH_SETTING);

      this.logger.info(`Restoring vault from ${VAULT_PATH_SETTING}: ${JSON.stringify(configured)}`);

      if (configured === undefined || configured.trim() === '') {
        this.logger.info('No vault configured; showing the welcome screen.');
        return;
      }

      const stat = await this.fs.stat(configured);

      if (stat?.kind !== 'directory') {
        this.logger.warn(`Configured vault is missing or not a directory: ${configured}`);
        return;
      }

      await this.open(configured);
    } finally {
      /*
       * Marked done however this ended, including on failure.
       *
       * Leaving it false would strand the sidebar on "loading" forever, which
       * is a worse outcome than showing the welcome screen: at least the
       * welcome screen offers a way forward.
       */
      this.restored = true;

      // open() already fired for the success case; this covers the paths that
      // returned early, so the sidebar leaves its loading state either way.
      if (this.layout === undefined) {
        this.stateChanged.fire(this.state);
      }
    }
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

  /**
   * Opens a vault without going through the folder picker.
   *
   * Exists so the save-then-restore cycle can be tested end to end; a modal
   * dialog cannot be driven from a test.
   */
  public async openForTesting(root: string): Promise<void> {
    await this.open(root);
  }

  public dispose(): void {
    this.stateChanged.dispose();
    this.contentsChanged.dispose();
    this.watcher?.dispose();
  }

  /**
   * Watches the vault for changes made anywhere -- by GitPad, by the OS file
   * manager, or by git pulling in another device's edits.
   *
   * The filesystem is the source of truth, so the tree is rebuilt from it
   * rather than patched in place; that is what keeps an external change from
   * leaving the sidebar showing something that is no longer there.
   */
  private watch(layout: VaultLayout): void {
    this.watcher?.dispose();

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(layout.root), '**/*'),
    );

    const fire = () => {
      this.contentsChanged.fire();
    };

    this.watcher.onDidCreate(fire);
    this.watcher.onDidDelete(fire);
    // Renames arrive as delete + create, so onDidChange is only needed for
    // edits -- which can still reorder the tree via the order file.
    this.watcher.onDidChange(fire);
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
    this.watch(this.layout);

    try {
      await vscode.workspace
        .getConfiguration()
        .update(VAULT_PATH_SETTING, root, vscode.ConfigurationTarget.Global);

      // Read back rather than trusting the write. A setting that fails to
      // persist looks identical to one that was never written, and the symptom
      // -- being asked to pick a vault on every reload -- appears a whole
      // session later.
      const readBack = vscode.workspace.getConfiguration().get<string>(VAULT_PATH_SETTING);

      if (readBack !== root) {
        this.logger.warn(
          `Vault path did not persist. Wrote ${root}, read back ${JSON.stringify(readBack)}.`,
        );
      } else {
        this.logger.info(`Vault path saved: ${root}`);
      }
    } catch (error) {
      // Not fatal: the vault is open for this session even if the setting
      // could not be written.
      this.logger.error(`Could not save ${VAULT_PATH_SETTING}`, error);
    }

    this.stateChanged.fire(this.state);
  }
}
