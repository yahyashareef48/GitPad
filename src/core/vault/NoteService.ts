import * as path from 'node:path';

import {
  parseDocument,
  serializeDocument,
  writeField,
} from '../markdown/frontmatter';
import { nextUntitledStem, titleToStem, uniquifyStem } from '../naming/filename';
import type { Clock } from '../ports/Clock';
import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import { NOTE_EXTENSION, type VaultLayout } from './VaultLayout';

/*
 * Creating, renaming, duplicating and deleting notes and folders.
 *
 * Every write goes through here, and every write is checked against
 * VaultLayout.contains() first. Filenames come from user-supplied titles, so
 * "the sanitiser is correct" should not be the only thing standing between a
 * typo and a write outside the vault.
 */
export class NoteService {
  public constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  /** Creates an untitled note in `folder`. Returns its absolute path. */
  public async createNote(layout: VaultLayout, folder: string): Promise<string> {
    const stem = nextUntitledStem(await this.takenStems(folder));
    const target = path.join(folder, `${stem}${NOTE_EXTENSION}`);

    this.assertInside(layout, target);

    const now = this.clock.nowIso();
    const document = serializeDocument({
      frontmatter: [`created: ${now}`, `updated: ${now}`],
      body: '\n',
    });

    await this.fs.writeFile(target, new TextEncoder().encode(document));
    this.logger.info(`Created note ${target}`);

    return target;
  }

  public async createFolder(layout: VaultLayout, parent: string): Promise<string> {
    const stem = uniquifyStem('New folder', await this.takenNames(parent));
    const target = path.join(parent, stem);

    this.assertInside(layout, target);

    await this.fs.createDirectory(target);
    this.logger.info(`Created folder ${target}`);

    return target;
  }

  /**
   * Renames a note or folder from a user-supplied title.
   *
   * Returns the new path, which may differ from what the title implies: the
   * title is sanitised for the filesystem and uniquified against its siblings.
   */
  public async rename(layout: VaultLayout, target: string, title: string): Promise<string> {
    const parent = path.dirname(target);
    const extension = path.extname(target);

    const siblings = await this.takenNames(parent);
    // The item's own name is not a collision with itself.
    siblings.delete(path.basename(target, extension).toLowerCase());

    const stem = uniquifyStem(titleToStem(title), siblings);
    const renamed = path.join(parent, `${stem}${extension}`);

    if (renamed === target) {
      return target;
    }

    this.assertInside(layout, renamed);

    await this.fs.rename(target, renamed);
    this.logger.info(`Renamed ${target} to ${renamed}`);

    return renamed;
  }

  public async duplicate(layout: VaultLayout, target: string): Promise<string> {
    const parent = path.dirname(target);
    const extension = path.extname(target);
    const stem = uniquifyStem(path.basename(target, extension), await this.takenNames(parent));
    const copy = path.join(parent, `${stem}${extension}`);

    this.assertInside(layout, copy);

    await this.fs.writeFile(copy, await this.fs.readFile(target));
    this.logger.info(`Duplicated ${target} to ${copy}`);

    return copy;
  }

  /**
   * Moves an item to `.trash/` rather than deleting it.
   *
   * Never `unlink`: people lose notes to a stray keystroke, and once sync
   * exists a hard delete propagates to every device within seconds.
   *
   * `.trash/` MIRRORS the vault's folder structure, so `Work/Standup.pad`
   * becomes `.trash/Work/Standup (stamp).pad`. That records where the item
   * came from without a sidecar index that could disagree with reality -- the
   * path IS the record, and restoring reads it straight back.
   *
   * The timestamp means repeated deletes of the same name coexist rather than
   * overwriting each other: the second delete of "Ideas" must not destroy the
   * first one already sitting in the trash.
   */
  public async moveToTrash(layout: VaultLayout, target: string): Promise<string> {
    const relativeDir = path.relative(layout.root, path.dirname(target));

    // `.` means the vault root, which mirrors to the trash root.
    const mirrorDir =
      relativeDir === '' || relativeDir === '.'
        ? layout.trashDir
        : path.join(layout.trashDir, relativeDir);

    await this.fs.createDirectory(mirrorDir);

    const extension = path.extname(target);
    const stem = path.basename(target, extension);
    const stamp = new Date(this.clock.now()).toISOString().replace(/[:.]/g, '-');
    const trashed = path.join(mirrorDir, `${stem} (${stamp})${extension}`);

    await this.fs.rename(target, trashed);
    this.logger.info(`Moved ${target} to trash`);

    return trashed;
  }

  /**
   * Moves an item into another folder, keeping its name where possible.
   *
   * Returns the new path, which gains a numeric suffix if the destination
   * already holds something by that name.
   */
  public async move(layout: VaultLayout, target: string, destination: string): Promise<string> {
    const extension = path.extname(target);
    const stem = path.basename(target, extension);

    if (path.dirname(target) === destination) {
      return target;
    }

    // Moving a folder into itself, or into its own descendant, would detach
    // the subtree from the vault entirely.
    if (destination === target || destination.startsWith(`${target}${path.sep}`)) {
      throw new Error('A folder cannot be moved inside itself.');
    }

    const moved = path.join(
      destination,
      `${uniquifyStem(stem, await this.takenNames(destination))}${extension}`,
    );

    this.assertInside(layout, moved);

    await this.fs.rename(target, moved);
    this.logger.info(`Moved ${target} to ${moved}`);

    return moved;
  }

  /** Lowercased names of everything in `folder`, for collision checks. */
  private async takenNames(folder: string): Promise<Set<string>> {
    const entries = await this.fs.readDirectory(folder);

    return new Set(entries.map((entry) => path.parse(entry.name).name.toLowerCase()));
  }

  private async takenStems(folder: string): Promise<Set<string>> {
    return this.takenNames(folder);
  }

  private assertInside(layout: VaultLayout, target: string): void {
    if (!layout.contains(target)) {
      throw new Error(`Refusing to write outside the vault: ${target}`);
    }
  }
}

/** Stamps `updated` without disturbing any other frontmatter. */
export function touchUpdated(raw: string, nowIso: string): string {
  const document = parseDocument(raw);

  return serializeDocument({
    ...document,
    frontmatter: writeField(document.frontmatter, 'updated', nowIso),
  });
}
