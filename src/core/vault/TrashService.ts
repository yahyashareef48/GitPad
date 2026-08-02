import * as path from 'node:path';

import { uniquifyStem } from '../naming/filename';
import type { Clock } from '../ports/Clock';
import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import type { VaultLayout } from './VaultLayout';

/*
 * Reading and emptying `.trash/`.
 *
 * Deleting into the trash lives in NoteService, next to the other file
 * operations. Everything you do to something already IN the trash lives here,
 * because it needs to understand the timestamped naming that deletion applies.
 */

export interface TrashEntry {
  /** Absolute path inside `.trash/`. */
  readonly id: string;
  /** The note's name as it was before deletion. */
  readonly name: string;
  /** When it was deleted, from the timestamp in the filename. */
  readonly deletedAt: string | undefined;
}

/**
 * Matches the suffix `moveToTrash` appends: ` (2026-08-02T01-23-45-678Z)`.
 *
 * Parsed rather than stored separately so the trash needs no index of its own
 * -- the filename carries everything, and a file dragged out of the folder by
 * hand cannot desynchronise anything.
 */
const TRASH_SUFFIX = /^(.*) \((\d{4}-\d{2}-\d{2}T[\d-]+Z)\)$/;

export class TrashService {
  public constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async list(layout: VaultLayout): Promise<readonly TrashEntry[]> {
    const entries = await this.fs.readDirectory(layout.trashDir).catch(() => []);

    return entries
      .map((entry) => {
        const stem = path.parse(entry.name).name;
        const match = TRASH_SUFFIX.exec(stem);

        return {
          id: path.join(layout.trashDir, entry.name),
          // A file put here by hand has no timestamp; showing its raw name
          // beats hiding it or refusing to list the folder.
          name: match?.[1] ?? stem,
          deletedAt: match?.[2],
        };
      })
      .sort((left, right) => (right.deletedAt ?? '').localeCompare(left.deletedAt ?? ''));
  }

  /**
   * Puts an item back where it came from, under its original name.
   *
   * The original folder is not recorded, so everything restores to the vault
   * root. Recording it would mean a sidecar index that can disagree with the
   * folder's actual contents -- and moving a restored note is one drag, while
   * a wrong index is a support question.
   */
  public async restore(layout: VaultLayout, entry: TrashEntry): Promise<string> {
    const extension = path.extname(entry.id);
    const taken = await this.takenNames(layout.root);
    const target = path.join(layout.root, `${uniquifyStem(entry.name, taken)}${extension}`);

    await this.fs.rename(entry.id, target);
    this.logger.info(`Restored ${entry.id} to ${target}`);

    return target;
  }

  /** Deletes one item permanently. */
  public async purge(entry: TrashEntry): Promise<void> {
    await this.fs.delete(entry.id, { recursive: true });
    this.logger.info(`Purged ${entry.id}`);
  }

  public async empty(layout: VaultLayout): Promise<number> {
    const entries = await this.list(layout);

    for (const entry of entries) {
      await this.purge(entry);
    }

    return entries.length;
  }

  /**
   * Removes items deleted longer ago than `retentionDays`.
   *
   * Items with no parseable timestamp are left alone: they were not put here
   * by GitPad, and deleting someone's file because we cannot read its name
   * would be indefensible.
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
        await this.purge(entry);
        removed += 1;
      }
    }

    return removed;
  }

  private async takenNames(folder: string): Promise<Set<string>> {
    const entries = await this.fs.readDirectory(folder).catch(() => []);

    return new Set(entries.map((entry) => path.parse(entry.name).name.toLowerCase()));
  }
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
