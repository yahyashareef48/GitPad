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
   * The timestamp suffix means repeated deletes of the same name coexist
   * instead of overwriting each other -- the second delete of "Ideas" must not
   * destroy the first one sitting in the trash.
   */
  public async moveToTrash(layout: VaultLayout, target: string): Promise<string> {
    await this.fs.createDirectory(layout.trashDir);

    const extension = path.extname(target);
    const stem = path.basename(target, extension);
    const stamp = new Date(this.clock.now()).toISOString().replace(/[:.]/g, '-');
    const trashed = path.join(layout.trashDir, `${stem} (${stamp})${extension}`);

    await this.fs.rename(target, trashed);
    this.logger.info(`Moved ${target} to trash`);

    return trashed;
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
