import type { Clock } from '../ports/Clock';
import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import { type VaultConfig, createVaultConfig, parseVaultConfig } from './VaultConfig';
import { VaultLayout } from './VaultLayout';

/*
 * Creating and opening vaults.
 *
 * Takes a root path as a parameter rather than reading a global setting, so
 * supporting several vaults later is a UI change instead of a refactor.
 */

const GITIGNORE_CONTENTS = `# GitPad
# Derived state -- rebuilt from the vault on demand, so not worth syncing.
${'.gitpad/cache/'}
# Per-device sync bookkeeping.
${'.gitpad/sync-state.json'}
`;

export class VaultService {
  public constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates the vault skeleton, or fills in whatever is missing.
   *
   * Safe to call on an existing vault: every step checks first. That matters
   * because "open an existing folder" and "create a new vault" both land here,
   * and because a half-written vault (interrupted first run, partial sync)
   * should heal rather than stay broken.
   */
  public async initialize(
    root: string,
    options: { readonly adoptedForeignRepo?: boolean } = {},
  ): Promise<VaultLayout> {
    const layout = new VaultLayout(root);

    await this.fs.createDirectory(layout.root);
    await this.fs.createDirectory(layout.metadataDir);
    await this.fs.createDirectory(layout.trashDir);

    const existing = await this.readConfig(root);

    if (existing === undefined) {
      const config = createVaultConfig(this.clock.nowIso(), options);

      await this.writeJson(layout.configPath, config);
      this.logger.info(`Initialised vault at ${root}`);
    } else {
      this.logger.info(`Opened existing vault at ${root} (schema ${existing.schemaVersion})`);
    }

    await this.ensureGitignore(layout);

    return layout;
  }

  public async readConfig(root: string): Promise<VaultConfig | undefined> {
    const layout = new VaultLayout(root);

    if ((await this.fs.stat(layout.configPath)) === undefined) {
      return undefined;
    }

    try {
      const raw = new TextDecoder().decode(await this.fs.readFile(layout.configPath));

      return parseVaultConfig(raw);
    } catch (error) {
      this.logger.error(`Could not read vault config at ${layout.configPath}`, error);

      return undefined;
    }
  }

  /**
   * Writes a `.gitignore` only when there isn't one.
   *
   * Never appends to or rewrites an existing file: if the user adopted a folder
   * that already has one, it is theirs, and silently editing it would be the
   * kind of surprise that makes people uninstall.
   */
  private async ensureGitignore(layout: VaultLayout): Promise<void> {
    if ((await this.fs.stat(layout.gitignorePath)) !== undefined) {
      return;
    }

    await this.fs.writeFile(layout.gitignorePath, new TextEncoder().encode(GITIGNORE_CONTENTS));
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    // Pretty-printed and newline-terminated: this file is committed, so it
    // should produce readable diffs rather than one long line.
    const text = `${JSON.stringify(value, undefined, 2)}\n`;

    await this.fs.writeFile(path, new TextEncoder().encode(text));
  }
}
