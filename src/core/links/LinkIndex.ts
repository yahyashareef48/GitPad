import * as path from 'node:path';

import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import { isVisibleFile, isVisibleFolder } from '../vault/visibility';
import { extractWikilinks, linkKey } from './wikilink';

/*
 * Which notes link to which.
 *
 * Built by scanning the vault, and rebuilt when it changes. There is no
 * persisted index: the filesystem is the source of truth (plan 1.6), and a
 * cache that can disagree with the disk is worse than a scan that cannot.
 */

export interface LinkGraph {
  /** Note path -> paths it links to. */
  readonly forward: ReadonlyMap<string, readonly string[]>;
  /** Note path -> paths that link to IT. This is what backlinks display. */
  readonly backward: ReadonlyMap<string, readonly string[]>;
  /**
   * Note path -> link targets that matched no note.
   *
   * Kept rather than discarded: a link to a note you have not written yet is a
   * normal way to work, and showing them is more useful than hiding them.
   */
  readonly unresolved: ReadonlyMap<string, readonly string[]>;
}

export class LinkIndex {
  public constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    private readonly extensions: ReadonlySet<string>,
  ) {}

  public async build(root: string): Promise<LinkGraph> {
    const files = await this.collect(root);

    /*
     * Targets resolve by filename stem, not by path.
     *
     * `[[Standup]]` should find the note wherever it lives, because that is
     * what makes wikilinks worth having -- a link that breaks when you move a
     * note into a folder is a link nobody trusts.
     */
    const byKey = new Map<string, string>();

    for (const file of files) {
      const key = linkKey(path.parse(file).name);

      // First writer wins, and files are collected depth-first in a stable
      // order, so a duplicate title resolves the same way on every machine.
      if (!byKey.has(key)) {
        byKey.set(key, file);
      }
    }

    const forward = new Map<string, string[]>();
    const backward = new Map<string, string[]>();
    const unresolved = new Map<string, string[]>();

    for (const file of files) {
      const text = await this.read(file);

      if (text === undefined) {
        continue;
      }

      for (const link of extractWikilinks(text)) {
        const target = byKey.get(linkKey(link.target));

        if (target === undefined) {
          push(unresolved, file, link.target);
          continue;
        }

        // A note linking to itself is legal but not a backlink worth showing.
        if (target === file) {
          continue;
        }

        push(forward, file, target);
        push(backward, target, file);
      }
    }

    this.logger.debug(`Link index built: ${files.length} notes, ${backward.size} linked`);

    return { forward, backward, unresolved };
  }

  /** Every document file under `root`, depth-first and alphabetical. */
  private async collect(root: string): Promise<readonly string[]> {
    const entries = await this.fs.readDirectory(root).catch(() => []);
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

    const files: string[] = [];

    for (const entry of sorted) {
      const full = path.join(root, entry.name);

      if (entry.kind === 'directory') {
        if (isVisibleFolder(entry.name)) {
          files.push(...(await this.collect(full)));
        }
      } else if (isVisibleFile(entry.name, this.extensions)) {
        files.push(full);
      }
    }

    return files;
  }

  private async read(file: string): Promise<string | undefined> {
    try {
      return new TextDecoder().decode(await this.fs.readFile(file));
    } catch (error) {
      // One unreadable note must not fail the whole index.
      this.logger.warn(`Skipping ${file} while indexing links`, error);

      return undefined;
    }
  }
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);

  if (existing === undefined) {
    map.set(key, [value]);
  } else if (!existing.includes(value)) {
    // Linking to the same note twice is one relationship, not two.
    existing.push(value);
  }
}
