import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { OrderService } from '../../src/core/ordering/OrderService';
import { parseOrderFile } from '../../src/core/ordering/orderFile';
import type { Logger } from '../../src/core/ports/Logger';
import type { Clock } from '../../src/core/ports/Clock';
import { NoteService } from '../../src/core/vault/NoteService';
import { VaultLayout } from '../../src/core/vault/VaultLayout';
import { InMemoryFileSystem } from './support/InMemoryFileSystem';

const VAULT = path.resolve('/vaults/notes');
const layout = new VaultLayout(VAULT);
const ORDER_FILE = path.join(VAULT, '.gitpad-order');

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const fixedClock: Clock = {
  now: () => 0,
  nowIso: () => '2026-08-01T00:00:00.000Z',
};

describe('OrderService.reorder', () => {
  const service = (fs: InMemoryFileSystem) => new OrderService(fs, silentLogger);

  it('moves an entry to the requested index', async () => {
    const fs = new InMemoryFileSystem();
    fs.seedDirectory(VAULT);

    await service(fs).reorder(VAULT, ['a.pad', 'b.pad', 'c.pad'], 'c.pad', 0);

    expect(parseOrderFile(fs.read(ORDER_FILE))).toEqual(['c.pad', 'a.pad', 'b.pad']);
  });

  it('moves an entry to the end', async () => {
    const fs = new InMemoryFileSystem();
    fs.seedDirectory(VAULT);

    await service(fs).reorder(VAULT, ['a.pad', 'b.pad', 'c.pad'], 'a.pad', 2);

    expect(parseOrderFile(fs.read(ORDER_FILE))).toEqual(['b.pad', 'c.pad', 'a.pad']);
  });

  it('clamps an index past the end rather than leaving a gap', async () => {
    const fs = new InMemoryFileSystem();
    fs.seedDirectory(VAULT);

    await service(fs).reorder(VAULT, ['a.pad', 'b.pad'], 'a.pad', 99);

    expect(parseOrderFile(fs.read(ORDER_FILE))).toEqual(['b.pad', 'a.pad']);
  });

  it('records an item that was not previously in the folder', async () => {
    // The move-into-a-folder case: the item arrives and needs placing.
    const fs = new InMemoryFileSystem();
    fs.seedDirectory(VAULT);

    await service(fs).reorder(VAULT, ['a.pad', 'moved.pad'], 'moved.pad', 0);

    expect(parseOrderFile(fs.read(ORDER_FILE))).toEqual(['moved.pad', 'a.pad']);
  });
});

describe('NoteService.move', () => {
  const service = (fs: InMemoryFileSystem) => new NoteService(fs, fixedClock, silentLogger);

  it('moves a note into a folder', async () => {
    const source = path.join(VAULT, 'Note.pad');
    const fs = new InMemoryFileSystem({ [source]: 'contents' });
    fs.seedDirectory(path.join(VAULT, 'Work'));

    const moved = await service(fs).move(layout, source, path.join(VAULT, 'Work'));

    expect(moved).toBe(path.join(VAULT, 'Work', 'Note.pad'));
    expect(fs.read(moved)).toBe('contents');
    expect(fs.has(source)).toBe(false);
  });

  it('uniquifies against a name already in the destination', async () => {
    const source = path.join(VAULT, 'Note.pad');
    const fs = new InMemoryFileSystem({
      [source]: 'moving',
      [path.join(VAULT, 'Work', 'Note.pad')]: 'already here',
    });

    const moved = await service(fs).move(layout, source, path.join(VAULT, 'Work'));

    expect(path.basename(moved)).toBe('Note 2.pad');
    expect(fs.read(path.join(VAULT, 'Work', 'Note.pad'))).toBe('already here');
  });

  it('is a no-op when the destination is where it already lives', async () => {
    const source = path.join(VAULT, 'Note.pad');
    const fs = new InMemoryFileSystem({ [source]: '' });

    expect(await service(fs).move(layout, source, VAULT)).toBe(source);
  });

  it('refuses to move a folder inside itself', async () => {
    // Would detach the whole subtree from the vault.
    const folder = path.join(VAULT, 'Work');
    const fs = new InMemoryFileSystem();
    fs.seedDirectory(path.join(folder, 'Deep'));

    await expect(service(fs).move(layout, folder, folder)).rejects.toThrow(/inside itself/);
    await expect(service(fs).move(layout, folder, path.join(folder, 'Deep'))).rejects.toThrow(
      /inside itself/,
    );
  });
});
