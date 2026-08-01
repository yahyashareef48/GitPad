import * as path from 'node:path';

import { applyOrder, parseOrderFile } from '../ordering/orderFile';
import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import { ORDER_FILENAME } from './VaultLayout';
import { displayName, isVisibleFile, isVisibleFolder } from './visibility';

/*
 * Builds the sidebar tree from what is actually on disk.
 *
 * The filesystem is the source of truth -- there is no index that could drift
 * out of sync with it. This walks the vault on demand and is re-run when the
 * watcher fires.
 */

export interface TreeNode {
  /** Absolute path. Stable and unique, so it doubles as the React key. */
  readonly id: string;
  /** What the user sees: for files the stem, since the title IS the filename. */
  readonly name: string;
  readonly kind: 'folder' | 'document';
  /** Present on folders only; absent on documents. */
  readonly children?: readonly TreeNode[];
}

export class VaultTree {
  public constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
    /** Extensions claimed by registered document types, e.g. `.pad`. */
    private readonly extensions: ReadonlySet<string>,
  ) {}

  public async build(root: string): Promise<readonly TreeNode[]> {
    return this.readFolder(root);
  }

  private async readFolder(folder: string): Promise<readonly TreeNode[]> {
    const entries = await this.fs.readDirectory(folder);

    const visible = entries.filter((entry) =>
      entry.kind === 'directory'
        ? isVisibleFolder(entry.name)
        : isVisibleFile(entry.name, this.extensions),
    );

    // Children are read in parallel: a deep vault is otherwise a long chain of
    // sequential round trips, which is noticeable over Remote SSH.
    const nodes = await Promise.all(
      visible.map(async (entry): Promise<TreeNode> => {
        const fullPath = path.join(folder, entry.name);

        if (entry.kind === 'directory') {
          return {
            id: fullPath,
            name: entry.name,
            kind: 'folder',
            children: await this.readFolder(fullPath),
          };
        }

        return { id: fullPath, name: displayName(entry.name), kind: 'document' };
      }),
    );

    return applyOrder(nodes, await this.readOrder(folder), (node) => path.basename(node.id));
  }

  /**
   * Reads `.gitpad-order`, treating any problem as "no recorded order".
   *
   * The file is advisory (see core/ordering/orderFile), so a missing or
   * unreadable one must degrade to alphabetical rather than failing the whole
   * tree -- one bad file should never blank the sidebar.
   */
  private async readOrder(folder: string): Promise<readonly string[]> {
    const orderPath = path.join(folder, ORDER_FILENAME);

    if ((await this.fs.stat(orderPath)) === undefined) {
      return [];
    }

    try {
      return parseOrderFile(new TextDecoder().decode(await this.fs.readFile(orderPath)));
    } catch (error) {
      this.logger.warn(`Ignoring unreadable order file at ${orderPath}`, error);

      return [];
    }
  }
}
