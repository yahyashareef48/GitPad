import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyOrder, parseOrderFile, serializeOrderFile } from '../../src/core/ordering/orderFile';
import type { Logger } from '../../src/core/ports/Logger';
import { VaultTree, type TreeNode } from '../../src/core/vault/VaultTree';
import { displayName, isVisibleFile, isVisibleFolder } from '../../src/core/vault/visibility';
import { InMemoryFileSystem } from './support/InMemoryFileSystem';

const VAULT = path.resolve('/vaults/notes');
const EXTENSIONS = new Set(['.pad']);

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Flattens to `name` / `name/child` strings so assertions read as a tree. */
function flatten(nodes: readonly TreeNode[], prefix = ''): string[] {
  return nodes.flatMap((node) => [
    `${prefix}${node.name}`,
    ...flatten(node.children ?? [], `${prefix}${node.name}/`),
  ]);
}

describe('visibility', () => {
  it('shows files whose extension a document type claims', () => {
    expect(isVisibleFile('note.pad', EXTENSIONS)).toBe(true);
    expect(isVisibleFile('NOTE.PAD', EXTENSIONS)).toBe(true);
  });

  it('hides every other file type', () => {
    expect(isVisibleFile('readme.md', EXTENSIONS)).toBe(false);
    expect(isVisibleFile('photo.png', EXTENSIONS)).toBe(false);
    expect(isVisibleFile('notes', EXTENSIONS)).toBe(false);
    expect(isVisibleFile('.env', EXTENSIONS)).toBe(false);
  });

  it('hides git and GitPad plumbing', () => {
    expect(isVisibleFolder('.git')).toBe(false);
    expect(isVisibleFolder('.gitpad')).toBe(false);
    expect(isVisibleFolder('.trash')).toBe(false);
    expect(isVisibleFolder('assets')).toBe(false);
    expect(isVisibleFile('.gitignore', EXTENSIONS)).toBe(false);
    expect(isVisibleFile('.gitpad-order', EXTENSIONS)).toBe(false);
  });

  it('shows an empty folder, since hiding is by name and not by contents', () => {
    // A folder you just created must not flicker out of existence.
    expect(isVisibleFolder('Work')).toBe(true);
  });

  it('displays a file by its stem, because the title is the filename', () => {
    expect(displayName('Standup notes.pad')).toBe('Standup notes');
    expect(displayName('v1.2 plan.pad')).toBe('v1.2 plan');
  });
});

describe('parseOrderFile', () => {
  it('reads one name per line, ignoring comments and blanks', () => {
    expect(parseOrderFile('# a comment\n\nWork\n  Ideas  \n')).toEqual(['Work', 'Ideas']);
  });

  it('ignores a repeated name rather than placing the entry twice', () => {
    expect(parseOrderFile('Work\nWork\nIdeas')).toEqual(['Work', 'Ideas']);
  });

  it('round-trips through serialization', () => {
    expect(parseOrderFile(serializeOrderFile(['b', 'a']))).toEqual(['b', 'a']);
  });
});

describe('applyOrder', () => {
  const identity = (value: string) => value;

  it('places listed entries first, in listed order', () => {
    expect(applyOrder(['a', 'b', 'c'], ['c', 'a'], identity)).toEqual(['c', 'a', 'b']);
  });

  it('sorts unlisted entries alphabetically, so new files land predictably', () => {
    expect(applyOrder(['c', 'a', 'b'], [], identity)).toEqual(['a', 'b', 'c']);
  });

  it('ignores names that no longer exist', () => {
    // A note deleted outside GitPad must not leave a hole or throw.
    expect(applyOrder(['a'], ['deleted', 'a'], identity)).toEqual(['a']);
  });

  it('keeps entries that share a display name', () => {
    // A `notes` folder and a `notes.pad` file both display as "notes".
    const entries = [
      { id: 1, key: 'notes' },
      { id: 2, key: 'notes' },
    ];

    expect(applyOrder(entries, ['notes'], (entry) => entry.key)).toHaveLength(2);
  });
});

describe('VaultTree', () => {
  const tree = (fs: InMemoryFileSystem) => new VaultTree(fs, silentLogger, EXTENSIONS);

  it('includes notes and folders, and nests them', async () => {
    const fs = new InMemoryFileSystem({
      [path.join(VAULT, 'Reading list.pad')]: '',
      [path.join(VAULT, 'Work', 'Standup.pad')]: '',
    });

    expect(flatten(await tree(fs).build(VAULT))).toEqual([
      'Reading list',
      'Work',
      'Work/Standup',
    ]);
  });

  it('excludes plumbing and unclaimed file types', async () => {
    const fs = new InMemoryFileSystem({
      [path.join(VAULT, 'Note.pad')]: '',
      [path.join(VAULT, 'README.md')]: '',
      [path.join(VAULT, '.gitignore')]: '',
      [path.join(VAULT, '.gitpad', 'config.json')]: '{}',
      [path.join(VAULT, '.trash', 'Old.pad')]: '',
    });

    expect(flatten(await tree(fs).build(VAULT))).toEqual(['Note']);
  });

  it('honours a recorded order', async () => {
    const fs = new InMemoryFileSystem({
      [path.join(VAULT, 'a.pad')]: '',
      [path.join(VAULT, 'b.pad')]: '',
      [path.join(VAULT, 'c.pad')]: '',
      [path.join(VAULT, '.gitpad-order')]: 'c.pad\nb.pad\n',
    });

    expect(flatten(await tree(fs).build(VAULT))).toEqual(['c', 'b', 'a']);
  });

  it('falls back to alphabetical when no order is recorded', async () => {
    const fs = new InMemoryFileSystem({
      [path.join(VAULT, 'c.pad')]: '',
      [path.join(VAULT, 'a.pad')]: '',
      [path.join(VAULT, 'b.pad')]: '',
    });

    expect(flatten(await tree(fs).build(VAULT))).toEqual(['a', 'b', 'c']);
  });

  it('survives an order file naming things that no longer exist', async () => {
    // Exactly what a git merge or an OS-level delete leaves behind.
    const fs = new InMemoryFileSystem({
      [path.join(VAULT, 'a.pad')]: '',
      [path.join(VAULT, '.gitpad-order')]: 'ghost.pad\na.pad\nalso-gone.pad\n',
    });

    expect(flatten(await tree(fs).build(VAULT))).toEqual(['a']);
  });

  it('keeps an empty folder visible', async () => {
    const fs = new InMemoryFileSystem();
    fs.seedDirectory(path.join(VAULT, 'Empty'));

    expect(flatten(await tree(fs).build(VAULT))).toEqual(['Empty']);
  });
});
