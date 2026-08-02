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

function vault(files: Record<string, string> = {}): InMemoryFileSystem {
  const fs = new InMemoryFileSystem(files);
  fs.seedDirectory(VAULT);
  fs.seedDirectory(layout.trashDir);
  return fs;
}

describe('TrashService', () => {
  const trash = (fs: InMemoryFileSystem, at = AUGUST) =>
    new TrashService(fs, clockAt(at), silentLogger);

  const notes = (fs: InMemoryFileSystem, at = AUGUST) =>
    new NoteService(fs, clockAt(at), silentLogger);

  it('lists a deleted note under its original name', async () => {
    const fs = vault({ [path.join(VAULT, 'Standup.pad')]: 'contents' });

    await notes(fs).moveToTrash(layout, path.join(VAULT, 'Standup.pad'));

    const entries = await trash(fs).list(layout);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Standup');
    expect(entries[0]?.deletedAt).toBeDefined();
  });

  it('restores a note to the vault root with its contents intact', async () => {
    const fs = vault({ [path.join(VAULT, 'Standup.pad')]: 'keep me' });
    await notes(fs).moveToTrash(layout, path.join(VAULT, 'Standup.pad'));

    const [entry] = await trash(fs).list(layout);
    const restored = await trash(fs).restore(layout, entry!);

    expect(path.basename(restored)).toBe('Standup.pad');
    expect(fs.read(restored)).toBe('keep me');
    expect(await trash(fs).list(layout)).toHaveLength(0);
  });

  it('does not overwrite a note that has taken the name since', async () => {
    const fs = vault({ [path.join(VAULT, 'Note.pad')]: 'original' });
    await notes(fs).moveToTrash(layout, path.join(VAULT, 'Note.pad'));

    fs.seedFile(path.join(VAULT, 'Note.pad'), 'a different note');

    const [entry] = await trash(fs).list(layout);
    const restored = await trash(fs).restore(layout, entry!);

    expect(path.basename(restored)).toBe('Note 2.pad');
    expect(fs.read(path.join(VAULT, 'Note.pad'))).toBe('a different note');
  });

  it('empties everything', async () => {
    const fs = vault({
      [path.join(VAULT, 'A.pad')]: '',
      [path.join(VAULT, 'B.pad')]: '',
    });

    await notes(fs).moveToTrash(layout, path.join(VAULT, 'A.pad'));
    await notes(fs, AUGUST + 1000).moveToTrash(layout, path.join(VAULT, 'B.pad'));

    expect(await trash(fs).empty(layout)).toBe(2);
    expect(await trash(fs).list(layout)).toHaveLength(0);
  });

  it('prunes only what is older than the retention period', async () => {
    const fs = vault({
      [path.join(VAULT, 'Old.pad')]: '',
      [path.join(VAULT, 'New.pad')]: '',
    });

    const fortyDaysAgo = AUGUST - 40 * 24 * 60 * 60 * 1000;

    await notes(fs, fortyDaysAgo).moveToTrash(layout, path.join(VAULT, 'Old.pad'));
    await notes(fs, AUGUST).moveToTrash(layout, path.join(VAULT, 'New.pad'));

    expect(await trash(fs).prune(layout, 30)).toBe(1);

    const remaining = await trash(fs).list(layout);

    expect(remaining.map((entry) => entry.name)).toEqual(['New']);
  });

  it('never prunes a file it did not put there', async () => {
    // No timestamp in the name means GitPad did not delete it. Removing
    // someone's file because we cannot read its name is indefensible.
    const fs = vault();
    fs.seedFile(path.join(layout.trashDir, 'dropped-in-by-hand.pad'), '');

    expect(await trash(fs).prune(layout, 1)).toBe(0);
    expect(await trash(fs).list(layout)).toHaveLength(1);
  });

  it('lists a hand-dropped file rather than hiding it', async () => {
    const fs = vault();
    fs.seedFile(path.join(layout.trashDir, 'mystery.pad'), '');

    const [entry] = await trash(fs).list(layout);

    expect(entry?.name).toBe('mystery');
    expect(entry?.deletedAt).toBeUndefined();
  });

  it('treats a retention of zero as "keep everything"', async () => {
    const fs = vault({ [path.join(VAULT, 'A.pad')]: '' });
    await notes(fs, AUGUST - 999999999).moveToTrash(layout, path.join(VAULT, 'A.pad'));

    expect(await trash(fs).prune(layout, 0)).toBe(0);
  });
});
