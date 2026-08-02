import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/core/ports/Clock';
import type { Logger } from '../../src/core/ports/Logger';
import { NoteService } from '../../src/core/vault/NoteService';
import { TrashService } from '../../src/core/vault/TrashService';
import { VaultLayout } from '../../src/core/vault/VaultLayout';
import { InMemoryFileSystem } from './support/InMemoryFileSystem';

const VAULT = path.resolve('/vaults/notes');
const layout = new VaultLayout(VAULT);

const AUGUST = Date.parse('2026-08-02T01:00:00.000Z');

const clockAt = (millis: number): Clock => ({
  now: () => millis,
  nowIso: () => new Date(millis).toISOString(),
});

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const at = (...segments: string[]) => path.join(VAULT, ...segments);

function vault(files: Record<string, string> = {}): InMemoryFileSystem {
  const fs = new InMemoryFileSystem(files);
  fs.seedDirectory(VAULT);
  return fs;
}

const trashOf = (fs: InMemoryFileSystem, when = AUGUST) =>
  new TrashService(fs, clockAt(when), silentLogger);

const notesOf = (fs: InMemoryFileSystem, when = AUGUST) =>
  new NoteService(fs, clockAt(when), silentLogger);

/** Deletes, then returns the single trash entry. */
async function deleteAndList(fs: InMemoryFileSystem, target: string, when = AUGUST) {
  await notesOf(fs, when).moveToTrash(layout, target);

  const entries = await trashOf(fs).list(layout);

  return entries[0]!;
}

describe('TrashService: where things come back to', () => {
  it('restores a root note to the root', async () => {
    const fs = vault({ [at('Standup.pad')]: 'contents' });

    const entry = await deleteAndList(fs, at('Standup.pad'));
    expect(entry.originalFolder).toBe('');

    const restored = await trashOf(fs).restore(layout, entry);

    expect(restored).toBe(at('Standup.pad'));
    expect(fs.read(restored)).toBe('contents');
  });

  it('restores a note to the folder it was deleted from', async () => {
    const fs = vault({ [at('Work', 'Standup.pad')]: 'contents' });

    const entry = await deleteAndList(fs, at('Work', 'Standup.pad'));
    expect(entry.originalFolder).toBe('Work');

    expect(await trashOf(fs).restore(layout, entry)).toBe(at('Work', 'Standup.pad'));
  });

  it('restores into a deeply nested folder', async () => {
    const fs = vault({ [at('Work', 'Q1', 'Reviews', 'Note.pad')]: 'deep' });

    const entry = await deleteAndList(fs, at('Work', 'Q1', 'Reviews', 'Note.pad'));

    expect(await trashOf(fs).restore(layout, entry)).toBe(
      at('Work', 'Q1', 'Reviews', 'Note.pad'),
    );
  });

  it('recreates the original folder when it has since been deleted', async () => {
    // The case where someone most wants a note back: its whole folder went too.
    const fs = vault({ [at('Work', 'Standup.pad')]: 'contents' });

    const entry = await deleteAndList(fs, at('Work', 'Standup.pad'));

    await fs.delete(at('Work'), { recursive: true });
    expect(await fs.stat(at('Work'))).toBeUndefined();

    const restored = await trashOf(fs).restore(layout, entry);

    expect(restored).toBe(at('Work', 'Standup.pad'));
    expect(await fs.stat(at('Work'))).toMatchObject({ kind: 'directory' });
  });

  it('does not overwrite a note that took the name since', async () => {
    const fs = vault({ [at('Work', 'Note.pad')]: 'original' });

    const entry = await deleteAndList(fs, at('Work', 'Note.pad'));
    fs.seedFile(at('Work', 'Note.pad'), 'a different note');

    const restored = await trashOf(fs).restore(layout, entry);

    expect(path.basename(restored)).toBe('Note 2.pad');
    expect(fs.read(at('Work', 'Note.pad'))).toBe('a different note');
  });

  it('keeps two notes of the same name from different folders apart', async () => {
    // Both are "Note"; each must go home to its own folder.
    const fs = vault({
      [at('A', 'Note.pad')]: 'from A',
      [at('B', 'Note.pad')]: 'from B',
    });

    await notesOf(fs).moveToTrash(layout, at('A', 'Note.pad'));
    await notesOf(fs, AUGUST + 1000).moveToTrash(layout, at('B', 'Note.pad'));

    for (const entry of await trashOf(fs).list(layout)) {
      await trashOf(fs).restore(layout, entry);
    }

    expect(fs.read(at('A', 'Note.pad'))).toBe('from A');
    expect(fs.read(at('B', 'Note.pad'))).toBe('from B');
  });
});

describe('TrashService: deleted folders', () => {
  it('lists a deleted folder as one entry, not its contents', async () => {
    const fs = vault({
      [at('Work', 'One.pad')]: '1',
      [at('Work', 'Two.pad')]: '2',
    });

    await notesOf(fs).moveToTrash(layout, at('Work'));

    const entries = await trashOf(fs).list(layout);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Work');
    expect(entries[0]?.kind).toBe('folder');
  });

  it('restores a folder with everything inside it', async () => {
    const fs = vault({
      [at('Work', 'One.pad')]: '1',
      [at('Work', 'Nested', 'Two.pad')]: '2',
    });

    const entry = await deleteAndList(fs, at('Work'));

    await trashOf(fs).restore(layout, entry);

    expect(fs.read(at('Work', 'One.pad'))).toBe('1');
    expect(fs.read(at('Work', 'Nested', 'Two.pad'))).toBe('2');
  });

  it('restores a nested folder to its parent', async () => {
    const fs = vault({ [at('Work', 'Q1', 'Note.pad')]: 'x' });

    const entry = await deleteAndList(fs, at('Work', 'Q1'));
    expect(entry.originalFolder).toBe('Work');

    await trashOf(fs).restore(layout, entry);

    expect(fs.read(at('Work', 'Q1', 'Note.pad'))).toBe('x');
  });
});

describe('TrashService: housekeeping', () => {
  it('leaves no empty mirror folders behind after a restore', async () => {
    // Otherwise the trash fills with the skeleton of every folder anything was
    // ever deleted from.
    const fs = vault({ [at('Work', 'Q1', 'Note.pad')]: 'x' });

    const entry = await deleteAndList(fs, at('Work', 'Q1', 'Note.pad'));
    await trashOf(fs).restore(layout, entry);

    expect(await fs.stat(path.join(layout.trashDir, 'Work'))).toBeUndefined();
  });

  it('empties everything, including nested items', async () => {
    const fs = vault({
      [at('A.pad')]: '',
      [at('Work', 'B.pad')]: '',
    });

    await notesOf(fs).moveToTrash(layout, at('A.pad'));
    await notesOf(fs, AUGUST + 1000).moveToTrash(layout, at('Work', 'B.pad'));

    expect(await trashOf(fs).empty(layout)).toBe(2);
    expect(await trashOf(fs).list(layout)).toHaveLength(0);
  });

  it('prunes only what is older than the retention period', async () => {
    const fs = vault({
      [at('Old.pad')]: '',
      [at('Work', 'New.pad')]: '',
    });

    const fortyDaysAgo = AUGUST - 40 * 24 * 60 * 60 * 1000;

    await notesOf(fs, fortyDaysAgo).moveToTrash(layout, at('Old.pad'));
    await notesOf(fs, AUGUST).moveToTrash(layout, at('Work', 'New.pad'));

    expect(await trashOf(fs).prune(layout, 30)).toBe(1);
    expect((await trashOf(fs).list(layout)).map((entry) => entry.name)).toEqual(['New']);
  });

  it('never prunes a file it did not put there', async () => {
    const fs = vault();
    fs.seedFile(path.join(layout.trashDir, 'dropped-in-by-hand.pad'), '');

    expect(await trashOf(fs).prune(layout, 1)).toBe(0);
    expect(await trashOf(fs).list(layout)).toHaveLength(1);
  });

  it('lists a hand-dropped file rather than hiding it', async () => {
    const fs = vault();
    fs.seedFile(path.join(layout.trashDir, 'mystery.pad'), '');

    const [entry] = await trashOf(fs).list(layout);

    expect(entry?.name).toBe('mystery');
    expect(entry?.deletedAt).toBeUndefined();
  });

  it('treats a retention of zero as "keep everything"', async () => {
    const fs = vault({ [at('A.pad')]: '' });
    await notesOf(fs, AUGUST - 999999999).moveToTrash(layout, at('A.pad'));

    expect(await trashOf(fs).prune(layout, 0)).toBe(0);
  });

  it('keeps repeated deletions of the same name apart', async () => {
    const fs = vault({ [at('Note.pad')]: 'first' });

    await notesOf(fs).moveToTrash(layout, at('Note.pad'));
    fs.seedFile(at('Note.pad'), 'second');
    await notesOf(fs, AUGUST + 60_000).moveToTrash(layout, at('Note.pad'));

    expect(await trashOf(fs).list(layout)).toHaveLength(2);
  });
});
