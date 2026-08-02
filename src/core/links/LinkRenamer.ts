import * as path from 'node:path';

import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import { LinkIndex } from './LinkIndex';
import { rewriteLinks } from './rewriteLinks';

/*
 * Keeps `[[wikilinks]]` working when a note is renamed.
 *
 * Moving a note already works -- links resolve by title, not by path. Deleting
 * one should break its links, and does, visibly. Renaming was the real gap:
 * every note pointing at the old title silently stopped resolving.
 */

export interface RenameLinkUpdate {
  /** Notes whose text would change. */
  readonly affected: readonly string[];
}

export class LinkRenamer {
  public constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    private readonly extensions: ReadonlySet<string>,
  ) {}

  /**
   * Finds which notes link to `oldPath`.
   *
   * Separate from applying the change so the caller can ask first. Rewriting
   * someone's notes is not something to do silently, however correct it is.
   */
  public async preview(root: string, oldPath: string): Promise<RenameLinkUpdate> {
    const graph = await new LinkIndex(this.fs, this.logger, this.extensions).build(root);

    return { affected: [...(graph.backward.get(oldPath) ?? [])] };
  }

  /**
   * Rewrites links in `affected` from the old title to the new one.
   *
   * Returns how many notes actually changed, which can be fewer than were
   * offered: a link inside a code block is matched by the index but
   * deliberately left alone here.
   */
  public async apply(
    affected: readonly string[],
    oldPath: string,
    newPath: string,
  ): Promise<number> {
    const oldTitle = path.parse(oldPath).name;
    const newTitle = path.parse(newPath).name;

    if (oldTitle === newTitle) {
      return 0;
    }

    let changed = 0;

    for (const file of affected) {
      try {
        const original = new TextDecoder().decode(await this.fs.readFile(file));
        const updated = rewriteLinks(original, oldTitle, newTitle);

        if (updated !== original) {
          await this.fs.writeFile(file, new TextEncoder().encode(updated));
          changed += 1;
        }
      } catch (error) {
        /*
         * One unwritable note must not abort the rest.
         *
         * A partial update leaves some links working and some not, which is
         * recoverable; aborting halfway leaves exactly the same thing plus a
         * failed operation the user cannot reason about.
         */
        this.logger.error(`Could not update links in ${file}`, error);
      }
    }

    this.logger.info(`Updated links in ${changed} note${changed === 1 ? '' : 's'}`);

    return changed;
  }
}
