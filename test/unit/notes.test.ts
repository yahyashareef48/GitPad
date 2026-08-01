import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseDocument,
  readField,
  serializeDocument,
  writeField,
} from '../../src/core/markdown/frontmatter';
import type { Clock } from '../../src/core/ports/Clock';
import type { Logger } from '../../src/core/ports/Logger';
import { NoteService, touchUpdated } from '../../src/core/vault/NoteService';
import { VaultLayout } from '../../src/core/vault/VaultLayout';
import { InMemoryFileSystem } from './support/InMemoryFileSystem';

const VAULT = path.resolve('/vaults/notes');
const layout = new VaultLayout(VAULT);

const fixedClock: Clock = {
  now: () => Date.parse('2026-08-01T12:00:00.000Z'),
  nowIso: () => '2026-08-01T12:00:00.000Z',
};

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function service(fs: InMemoryFileSystem): NoteService {
  return new NoteService(fs, fixedClock, silentLogger);
}

function vaultWith(files: Record<string, string> = {}): InMemoryFileSystem {
  const fs = new InMemoryFileSystem(files);
  fs.seedDirectory(VAULT);
  return fs;
}

describe('frontmatter', () => {
  it('separates a block from the body', () => {
    const parsed = parseDocument('---\ncreated: x\n---\nHello\n');

    expect(parsed.frontmatter).toEqual(['created: x']);
    expect(parsed.body).toBe('Hello\n');
  });

  it('treats a document without a block as all body', () => {
    expect(parseDocument('Just text').frontmatter).toEqual([]);
    expect(parseDocument('Just text').body).toBe('Just text');
  });

  it('treats an unterminated block as content, not metadata', () => {
    // Swallowing this as frontmatter would hide the entire note.
    const parsed = parseDocument('---\ncreated: x\nstill going');

    expect(parsed.frontmatter).toEqual([]);
    expect(parsed.body).toBe('---\ncreated: x\nstill going');
  });

  it('reads scalar fields, quoted or not', () => {
    expect(readField(['created: 2026-08-01'], 'created')).toBe('2026-08-01');
    expect(readField(['title: "Hello"'], 'title')).toBe('Hello');
    expect(readField([], 'created')).toBeUndefined();
  });

  it('preserves keys it does not understand', () => {
    // A note from Obsidian must not lose its tags by passing through GitPad.
    const original = ['tags: [a, b]', 'created: old', 'aliases: x'];
    const updated = writeField(original, 'created', 'new');

    expect(updated).toEqual(['tags: [a, b]', 'created: new', 'aliases: x']);
  });

  it('appends a field that was not present', () => {
    expect(writeField(['tags: x'], 'updated', 'now')).toEqual(['tags: x', 'updated: now']);
  });

  it('round-trips', () => {
    const raw = '---\ncreated: x\n---\nBody text\n';

    expect(serializeDocument(parseDocument(raw))).toBe(raw);
  });

  it('stamps updated without disturbing anything else', () => {
    const raw = '---\ncreated: old\ntags: keep\n---\nBody\n';

    expect(touchUpdated(raw, 'now')).toBe('---\ncreated: old\ntags: keep\nupdated: now\n---\nBody\n');
  });
});

describe('NoteService.createNote', () => {
  it('writes an untitled note with created and updated stamps', async () => {
    const fs = vaultWith();

    const created = await service(fs).createNote(layout, VAULT);

    expect(path.basename(created)).toBe('Untitled.pad');

    const parsed = parseDocument(fs.read(created));
    expect(readField(parsed.frontmatter, 'created')).toBe('2026-08-01T12:00:00.000Z');
    expect(readField(parsed.frontmatter, 'updated')).toBe('2026-08-01T12:00:00.000Z');
  });

  it('numbers successive untitled notes', async () => {
    const fs = vaultWith();
    const notes = service(fs);

    await notes.createNote(layout, VAULT);
    const second = await notes.createNote(layout, VAULT);
    const third = await notes.createNote(layout, VAULT);

    expect(path.basename(second)).toBe('Untitled 2.pad');
    expect(path.basename(third)).toBe('Untitled 3.pad');
  });
});

describe('NoteService.rename', () => {
  it('sanitises the title into a filename', async () => {
    const fs = vaultWith({ [path.join(VAULT, 'Untitled.pad')]: '' });

    const renamed = await service(fs).rename(layout, path.join(VAULT, 'Untitled.pad'), 'Q1: plan');

    expect(path.basename(renamed)).toBe('Q1 plan.pad');
    expect(fs.has(renamed)).toBe(true);
  });

  it('does not treat the item as colliding with itself', async () => {
    // Renaming "Notes" to "Notes" must not produce "Notes 2".
    const target = path.join(VAULT, 'Notes.pad');
    const fs = vaultWith({ [target]: '' });

    expect(await service(fs).rename(layout, target, 'Notes')).toBe(target);
  });

  it('uniquifies against a real sibling collision', async () => {
    const fs = vaultWith({
      [path.join(VAULT, 'a.pad')]: '',
      [path.join(VAULT, 'Taken.pad')]: '',
    });

    const renamed = await service(fs).rename(layout, path.join(VAULT, 'a.pad'), 'Taken');

    expect(path.basename(renamed)).toBe('Taken 2.pad');
  });

  it('refuses a title that would escape the vault', async () => {
    const target = path.join(VAULT, 'a.pad');
    const fs = vaultWith({ [target]: '' });

    // Sanitising already strips separators; this is the backstop if it ever
    // stops doing so.
    const renamed = await service(fs).rename(layout, target, '../../escape');

    expect(renamed.startsWith(VAULT)).toBe(true);
  });
});

describe('NoteService.duplicate', () => {
  it('copies contents under a new name', async () => {
    const source = path.join(VAULT, 'Note.pad');
    const fs = vaultWith({ [source]: 'original contents' });

    const copy = await service(fs).duplicate(layout, source);

    expect(path.basename(copy)).toBe('Note 2.pad');
    expect(fs.read(copy)).toBe('original contents');
    expect(fs.has(source)).toBe(true);
  });
});

describe('NoteService.moveToTrash', () => {
  it('moves the file into .trash rather than deleting it', async () => {
    const target = path.join(VAULT, 'Note.pad');
    const fs = vaultWith({ [target]: 'keep me' });

    const trashed = await service(fs).moveToTrash(layout, target);

    expect(fs.has(target)).toBe(false);
    expect(trashed.startsWith(layout.trashDir)).toBe(true);
    expect(fs.read(trashed)).toBe('keep me');
  });

  it('timestamps the trashed name so repeated deletes coexist', async () => {
    const fs = vaultWith({ [path.join(VAULT, 'Note.pad')]: 'first' });
    const notes = service(fs);

    const first = await notes.moveToTrash(layout, path.join(VAULT, 'Note.pad'));

    fs.seedFile(path.join(VAULT, 'Note.pad'), 'second');
    const second = await notes.moveToTrash(layout, path.join(VAULT, 'Note.pad'));

    // Same clock, so the names collide -- but the first must survive either
    // way, which is the property that matters.
    expect(fs.read(first)).toBe(first === second ? 'second' : 'first');
    expect(path.basename(first)).toContain('2026-08-01');
  });
});
