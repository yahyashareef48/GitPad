import * as path from 'node:path';

/*
 * The well-known paths inside a vault.
 *
 * Pure: this knows the shape of a vault but never touches the disk, so the
 * rules stay assertable without a filesystem.
 */

/** Notes. A custom extension so GitPad never claims anyone else's `.md` files. */
export const NOTE_EXTENSION = '.pad';

/** App state. Committed, except for the cache and sync-state inside it. */
export const METADATA_DIR = '.gitpad';

export const CONFIG_FILENAME = 'config.json';
export const CACHE_DIR = 'cache';

/** Soft deletes. Synced, so a note deleted on one device is restorable on another. */
export const TRASH_DIR = '.trash';

/**
 * Per-folder manual ordering. Doubles as the marker that keeps an empty folder
 * alive through a sync -- git tracks files, not directories.
 */
export const ORDER_FILENAME = '.gitpad-order';

export class VaultLayout {
  public constructor(public readonly root: string) {}

  public get metadataDir(): string {
    return path.join(this.root, METADATA_DIR);
  }

  public get configPath(): string {
    return path.join(this.metadataDir, CONFIG_FILENAME);
  }

  public get cacheDir(): string {
    return path.join(this.metadataDir, CACHE_DIR);
  }

  public get trashDir(): string {
    return path.join(this.root, TRASH_DIR);
  }

  public get gitignorePath(): string {
    return path.join(this.root, '.gitignore');
  }

  /** Absolute path for a vault-relative location. */
  public resolve(...segments: readonly string[]): string {
    return path.join(this.root, ...segments);
  }

  public orderFileIn(folder: string): string {
    return path.join(folder, ORDER_FILENAME);
  }

  /**
   * Whether `candidate` lies inside the vault.
   *
   * Every write should be checked against this. A note title becomes a
   * filename (see core/naming), and while sanitising strips `..` and path
   * separators, a bug there would otherwise mean writing outside the vault.
   * Cheap insurance at the boundary rather than trust in one function.
   */
  public contains(candidate: string): boolean {
    const relative = path.relative(this.root, path.resolve(candidate));

    // Empty means the path IS the root; `..` means above it; absolute means a
    // different drive on Windows.
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }
}
