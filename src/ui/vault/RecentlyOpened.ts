import * as path from 'node:path';

import type * as vscode from 'vscode';

import type { RecentItemDto } from '../../shared/protocol';

/*
 * The "recently opened" list.
 *
 * Stored in the extension's globalState, not in the vault and not in settings:
 * this is device-local by design. Syncing it would put your laptop's history
 * on your desktop, which is noise rather than continuity, and it would make
 * every note you open a change that needs committing.
 */

const STORAGE_KEY = 'gitpad.recentlyOpened';

export class RecentlyOpened {
  /**
   * `limit` is a function, not a number.
   *
   * It is a user setting, so reading it once at construction means changing it
   * does nothing until the window is reloaded -- including setting it to 0 to
   * hide the section, which is exactly when someone expects an immediate
   * result.
   */
  public constructor(
    private readonly memento: vscode.Memento,
    private readonly limit: () => number,
  ) {}

  public list(vaultRoot: string): readonly RecentItemDto[] {
    const limit = Math.max(0, this.limit());

    if (limit === 0) {
      return [];
    }

    return this.read()
      // Entries from other vaults are irrelevant here, and a vault the user
      // has moved on from should not haunt the list.
      .filter((id) => isInside(vaultRoot, id))
      .slice(0, limit)
      .map((id) => ({ id, name: path.parse(id).name }));
  }

  public async record(id: string): Promise<void> {
    // Re-opening moves an entry to the front rather than duplicating it.
    const next = [id, ...this.read().filter((existing) => existing !== id)];

    // Trimmed generously rather than to `limit`: switching vaults should not
    // permanently discard the other vault's history.
    await this.memento.update(STORAGE_KEY, next.slice(0, 50));
  }

  /** Drops an entry whose file no longer exists, so the list self-heals. */
  public async forget(id: string): Promise<void> {
    await this.memento.update(
      STORAGE_KEY,
      this.read().filter((existing) => existing !== id),
    );
  }

  private read(): readonly string[] {
    const stored = this.memento.get<unknown>(STORAGE_KEY);

    // Defensive: globalState survives upgrades, so its shape is not guaranteed
    // to be whatever this version expects.
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return relative !== '' && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}
