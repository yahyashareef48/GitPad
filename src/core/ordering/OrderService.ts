import * as path from 'node:path';

import type { FileSystem } from '../ports/FileSystem';
import type { Logger } from '../ports/Logger';
import { ORDER_FILENAME } from '../vault/VaultLayout';
import { parseOrderFile, serializeOrderFile } from './orderFile';

/*
 * Reading and writing the per-folder `.gitpad-order` file.
 *
 * The file is advisory (see orderFile.ts): it records a preference, never the
 * truth about what exists. Writing it therefore records the CURRENT visible
 * order and nothing else -- no attempt to preserve entries for files that are
 * gone, because a stale name is exactly what makes an order file rot.
 */
export class OrderService {
  public constructor(
    private readonly fs: FileSystem,
    private readonly logger: Logger,
  ) {}

  public async read(folder: string): Promise<readonly string[]> {
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

  /** Records `names` (filenames, not display titles) as the order of `folder`. */
  public async write(folder: string, names: readonly string[]): Promise<void> {
    const orderPath = path.join(folder, ORDER_FILENAME);

    await this.fs.writeFile(orderPath, new TextEncoder().encode(serializeOrderFile(names)));
    this.logger.debug(`Wrote order for ${folder}: ${names.length} entries`);
  }

  /**
   * Moves `name` to `index` within `folder`.
   *
   * `siblings` is the folder's current visible order, which the caller already
   * has from the tree. Deriving it here instead would re-read the directory and
   * risk disagreeing with what the user just dragged.
   */
  public async reorder(
    folder: string,
    siblings: readonly string[],
    name: string,
    index: number,
  ): Promise<void> {
    const without = siblings.filter((sibling) => sibling !== name);
    const clamped = Math.max(0, Math.min(index, without.length));

    await this.write(folder, [...without.slice(0, clamped), name, ...without.slice(clamped)]);
  }
}
