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

    const byKey = groupByTitle(files);

    const forward = new Map<string, string[]>();
    const backward = new Map<string, string[]>();
    const unresolved = new Map<string, string[]>();

    for (const file of files) {
      const text = await this.read(file);

      if (text === undefined) {
        continue;
      }

      for (const link of extractWikilinks(text)) {
        const target = resolveIn(byKey, link.target, file);

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

/**
 * Groups note paths by their title, keeping ALL candidates.
 *
 * Two notes can share a title -- `test.pad` at the root and `Work/test.pad`
 * are both legal, and a vault of any size eventually has some. Storing only
 * the first would make resolution depend on scan order.
 */
export function groupByTitle(files: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const byKey = new Map<string, string[]>();

  for (const file of files) {
    push(byKey, linkKey(path.parse(file).name), file);
  }

  return byKey;
}

/**
 * Picks which note `target` means, from the point of view of `sourceFile`.
 *
 * The rule, in order:
 *   1. a note with that title in the SAME folder as the link
 *   2. otherwise the shallowest match, ties broken alphabetically
 *
 * Same-folder-first is what Obsidian does, and it is the only rule that makes
 * duplicate titles usable: `Work/meeting.pad` linking to `[[notes]]` should
 * find `Work/notes.pad`, not a `notes.pad` on the other side of the vault.
 *
 * Exported so the editor's click handler resolves through the SAME function
 * the index does. When they were separate, both said "first match wins" while
 * disagreeing about what first meant -- so the sidebar could report a link
 * that clicking somewhere else.
 */
export function resolveIn(
  byTitle: ReadonlyMap<string, readonly string[]>,
  target: string,
  sourceFile?: string,
): string | undefined {
  /*
   * A target may be path-qualified: `[[Work/test]]` rather than `[[test]]`.
   *
   * Autocomplete writes that form when a title is ambiguous, because the plain
   * title would resolve by proximity and could open a different note from the
   * one the user picked from the list.
   */
  const qualified = /[\\/]/.test(target);

  if (qualified) {
    const wanted = target.split(/[\\/]/).filter((part) => part !== '');
    const stem = wanted[wanted.length - 1] ?? '';

    for (const candidate of byTitle.get(linkKey(stem)) ?? []) {
      const parts = candidate.split(/[\\/]/);
      const tail = parts.slice(-wanted.length);

      // Compared as a path SUFFIX, so `Work/test` matches
      // `/vault/Work/test.pad` without the link needing the vault's location.
      const matches = tail.every(
        (part, index) => linkKey(part.replace(/\.[^.]+$/, '')) === linkKey(wanted[index] ?? ''),
      );

      if (matches) {
        return candidate;
      }
    }

    return undefined;
  }

  const candidates = byTitle.get(linkKey(target));

  if (candidates === undefined || candidates.length === 0) {
    return undefined;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (sourceFile !== undefined) {
    const sameFolder = candidates.find(
      (candidate) => path.dirname(candidate) === path.dirname(sourceFile),
    );

    if (sameFolder !== undefined) {
      return sameFolder;
    }
  }

  // Shallowest wins, then alphabetical -- deterministic, and independent of
  // the order the vault happened to be scanned in.
  return [...candidates].sort((left, right) => {
    const depth = left.split(path.sep).length - right.split(path.sep).length;

    return depth !== 0 ? depth : left.localeCompare(right);
  })[0];
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
