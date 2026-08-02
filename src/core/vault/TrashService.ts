import * as path from 'node:path';

import { uniquifyStem } from '../naming/filename';
import type { Clock } from '../ports/Clock';
import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import type { VaultLayout } from './VaultLayout';

/*
 * Reading, restoring and emptying `.trash/`.
 *
 * The trash MIRRORS the vault's folder structure: a note deleted from
 * `Work/Q1/` lands in `.trash/Work/Q1/`. That is what lets restore put it back
 * where it came from, and it does so without any index -- the path is the
 * record, so a file moved by hand, or by git during a merge, cannot leave a
 * stale entry pointing nowhere.
 *
 * Deleting INTO the trash lives in NoteService, beside the other file
 * operations. Everything done to something already in the trash lives here,
 * because it needs to understand the mirrored layout and the timestamped
 * naming.
 */

export interface TrashEntry {
  /** Absolute path inside `.trash/`. */
  readonly id: string;
  /** The item's name as it was before deletion. */
  readonly name: string;
  /**
   * Vault-relative folder it will be restored to. Empty string for the root.
   *
   * Shown in the UI so "restore" is never a surprise.
   */
  readonly originalFolder: string;
  readonly kind: 'document' | 'folder';
  /** When it was deleted, from the timestamp in the name. */
  readonly deletedAt: string | undefined;
}

/** Matches the suffix `moveToTrash` appends: ` (2026-08-02T01-23-45-678Z)`. */
const TRASH_SUFFIX = /^(.*) \((\d{4}-\d{2}-\d{2}T[\d-]+Z)\)$/;

export class TrashService {
  public constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async list(layout: VaultLayout): Promise<readonly TrashEntry[]> {
    const entries = await this.collect(layout, layout.trashDir);

    return [...entries].sort((left, right) =>
      (right.deletedAt ?? '').localeCompare(left.deletedAt ?? ''),
    );
  }

  /**
   * Walks the mirrored structure.
   *
   * A directory whose name carries a timestamp is a DELETED FOLDER and is
   * listed as one entry -- its contents went with it and are restored with it.
   * A directory without one is only mirroring the vault's shape, so it is
   * descended into and never listed.
   */
  private async collect(layout: VaultLayout, folder: string): Promise<readonly TrashEntry[]> {
    const entries = await this.fs.readDirectory(folder).catch(() => []);
    const found: TrashEntry[] = [];

    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      const stem = entry.kind === 'directory' ? entry.name : path.parse(entry.name).name;
      const match = TRASH_SUFFIX.exec(stem);

      if (entry.kind === 'directory' && match === null) {
        found.push(...(await this.collect(layout, full)));
        continue;
      }

      found.push({
        id: full,
        // A file put here by hand has no timestamp; showing its raw name beats
        // hiding it or refusing to list the folder at all.
        name: match?.[1] ?? stem,
        originalFolder: toOriginalFolder(layout, folder),
        kind: entry.kind === 'directory' ? 'folder' : 'document',
        deletedAt: match?.[2],
      });
    }

    return found;
  }

  /**
   * Puts an item back where it came from.
   *
   * The original folder is recreated if it has since been deleted -- otherwise
   * restoring a note whose folder is also in the trash would fail, which is
   * exactly the case where someone most wants it back.
   *
   * A name taken since the deletion is uniquified rather than overwritten: the
   * note occupying it now is someone's work too.
   */
  public async restore(layout: VaultLayout, entry: TrashEntry): Promise<string> {
    const destinationFolder =
      entry.originalFolder === ''
        ? layout.root
        : path.join(layout.root, entry.originalFolder);

    await this.fs.createDirectory(destinationFolder);

    const extension = entry.kind === 'folder' ? '' : path.extname(entry.id);
    const taken = await this.takenNames(destinationFolder);
    const target = path.join(destinationFolder, `${uniquifyStem(entry.name, taken)}${extension}`);

    this.assertInside(layout, target);

    await this.fs.rename(entry.id, target);
    await this.pruneEmptyMirrors(layout, path.dirname(entry.id));

    this.logger.info(`Restored ${entry.id} to ${target}`);

    return target;
  }

  /** Deletes one item permanently, including a folder's contents. */
  public async purge(layout: VaultLayout, entry: TrashEntry): Promise<void> {
    await this.fs.delete(entry.id, { recursive: true });
    await this.pruneEmptyMirrors(layout, path.dirname(entry.id));

    this.logger.info(`Purged ${entry.id}`);
  }

  public async empty(layout: VaultLayout): Promise<number> {
    const entries = await this.list(layout);

    for (const entry of entries) {
      await this.purge(layout, entry);
    }

    return entries.length;
  }

  /**
   * Removes items deleted longer ago than `retentionDays`.
   *
   * Items with no parseable timestamp are left alone: GitPad did not put them
   * there, and deleting someone's file because we cannot read its name would
   * be indefensible.
   */
  public async prune(layout: VaultLayout, retentionDays: number): Promise<number> {
    if (retentionDays <= 0) {
      return 0;
    }

    const cutoff = this.clock.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const entry of await this.list(layout)) {
      const deletedAt = parseStamp(entry.deletedAt);

      if (deletedAt !== undefined && deletedAt < cutoff) {
        await this.purge(layout, entry);
        removed += 1;
      }
    }

    return removed;
  }

  /**
   * Removes mirror folders left empty by a restore or purge.
   *
   * Without this the trash slowly fills with the skeleton of every folder
   * anything was ever deleted from, which looks like leftover rubbish and,
   * once sync exists, is committed as such.
   */
  private async pruneEmptyMirrors(layout: VaultLayout, folder: string): Promise<void> {
    let current = folder;

    while (current !== layout.trashDir && current.startsWith(layout.trashDir)) {
      const entries = await this.fs.readDirectory(current).catch(() => []);

      if (entries.length > 0) {
        return;
      }

      await this.fs.delete(current, { recursive: true }).catch(() => undefined);
      current = path.dirname(current);
    }
  }

  private async takenNames(folder: string): Promise<Set<string>> {
    const entries = await this.fs.readDirectory(folder).catch(() => []);

    return new Set(entries.map((entry) => path.parse(entry.name).name.toLowerCase()));
  }

  /** A trash path is derived, not user input, but restoring writes into the vault. */
  private assertInside(layout: VaultLayout, target: string): void {
    if (!layout.contains(target)) {
      throw new Error(`Refusing to restore outside the vault: ${target}`);
    }
  }
}

/** The vault-relative folder a trash location mirrors. */
function toOriginalFolder(layout: VaultLayout, trashFolder: string): string {
  const relative = path.relative(layout.trashDir, trashFolder);

  return relative === '' || relative === '.' ? '' : relative;
}

/** Turns `2026-08-02T01-23-45-678Z` back into a timestamp. */
function parseStamp(stamp: string | undefined): number | undefined {
  if (stamp === undefined) {
    return undefined;
  }

  // The colons and dot were replaced with dashes to make a legal filename;
  // this puts them back so Date can read it.
  const iso = stamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );

  const parsed = Date.parse(iso);

  return Number.isNaN(parsed) ? undefined : parsed;
}
