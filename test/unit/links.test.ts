import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LinkIndex } from '../../src/core/links/LinkIndex';
import { extractWikilinks, linkKey } from '../../src/core/links/wikilink';
import type { Logger } from '../../src/core/ports/Logger';
import { InMemoryFileSystem } from './support/InMemoryFileSystem';

const VAULT = path.resolve('/vaults/notes');
const EXTENSIONS = new Set(['.pad']);

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const note = (...segments: string[]) => path.join(VAULT, ...segments);

describe('extractWikilinks', () => {
  it('finds a plain link', () => {
    expect(extractWikilinks('see [[Standup]] for details')).toEqual([
      { target: 'Standup', label: 'Standup' },
    ]);
  });

  it('finds a link with a display label', () => {
    expect(extractWikilinks('see [[Standup|yesterday]]')).toEqual([
      { target: 'Standup', label: 'yesterday' },
    ]);
  });

  it('finds several links in order', () => {
    expect(extractWikilinks('[[A]] then [[B]]').map((link) => link.target)).toEqual(['A', 'B']);
  });

  it('trims surrounding whitespace', () => {
    expect(extractWikilinks('[[  Spaced  ]]')).toEqual([
      { target: 'Spaced', label: 'Spaced' },
    ]);
  });

  it('ignores links inside inline code', () => {
    // A note explaining the syntax must not generate phantom links.
    expect(extractWikilinks('type `[[Example]]` to link')).toEqual([]);
  });

  it('ignores links inside fenced code blocks', () => {
    expect(extractWikilinks('```\n[[Example]]\n```\n')).toEqual([]);
  });

  it('ignores an empty target', () => {
    expect(extractWikilinks('[[]] and [[   ]]')).toEqual([]);
  });

  it('does not let an unclosed bracket swallow the document', () => {
    // Without the newline guard, a stray `[[` would consume everything after.
    expect(extractWikilinks('[[unclosed\n\nrest of the note')).toEqual([]);
  });
});

describe('linkKey', () => {
  it('matches regardless of case or surrounding space', () => {
    // Filenames are case-insensitive on Windows and macOS, so resolving
    // case-sensitively would behave differently per machine.
    expect(linkKey('  My Note ')).toBe(linkKey('my note'));
  });
});

describe('LinkIndex', () => {
  const index = (fs: InMemoryFileSystem) => new LinkIndex(fs, silentLogger, EXTENSIONS);

  it('records a link in both directions', async () => {
    const fs = new InMemoryFileSystem({
      [note('A.pad')]: 'links to [[B]]',
      [note('B.pad')]: 'no links here',
    });

    const graph = await index(fs).build(VAULT);

    expect(graph.forward.get(note('A.pad'))).toEqual([note('B.pad')]);
    expect(graph.backward.get(note('B.pad'))).toEqual([note('A.pad')]);
  });

  it('resolves a note in any folder, so moving it does not break links', async () => {
    const fs = new InMemoryFileSystem({
      [note('A.pad')]: 'see [[Standup]]',
      [note('Work', 'Deep', 'Standup.pad')]: '',
    });

    expect(await index(fs).build(VAULT).then((g) => g.forward.get(note('A.pad')))).toEqual([
      note('Work', 'Deep', 'Standup.pad'),
    ]);
  });

  it('resolves case-insensitively', async () => {
    const fs = new InMemoryFileSystem({
      [note('A.pad')]: 'see [[standup NOTES]]',
      [note('Standup Notes.pad')]: '',
    });

    expect(await index(fs).build(VAULT).then((g) => g.forward.size)).toBe(1);
  });

  it('keeps links to notes that do not exist yet', async () => {
    // Writing a link before the note is a normal way to work.
    const fs = new InMemoryFileSystem({ [note('A.pad')]: 'planning [[Not Written Yet]]' });

    const graph = await index(fs).build(VAULT);

    expect(graph.unresolved.get(note('A.pad'))).toEqual(['Not Written Yet']);
    expect(graph.forward.has(note('A.pad'))).toBe(false);
  });

  it('counts a repeated link once', async () => {
    const fs = new InMemoryFileSystem({
      [note('A.pad')]: '[[B]] and again [[B]]',
      [note('B.pad')]: '',
    });

    expect(await index(fs).build(VAULT).then((g) => g.backward.get(note('B.pad')))).toEqual([
      note('A.pad'),
    ]);
  });

  it('ignores a note linking to itself', async () => {
    const fs = new InMemoryFileSystem({ [note('A.pad')]: 'see [[A]]' });

    expect(await index(fs).build(VAULT).then((g) => g.backward.size)).toBe(0);
  });

  it('collects backlinks from several notes', async () => {
    const fs = new InMemoryFileSystem({
      [note('A.pad')]: '[[Target]]',
      [note('B.pad')]: '[[Target]]',
      [note('Target.pad')]: '',
    });

    expect(await index(fs).build(VAULT).then((g) => g.backward.get(note('Target.pad')))).toEqual([
      note('A.pad'),
      note('B.pad'),
    ]);
  });

  it('prefers a same-name note in the same folder as the link', async () => {
    // Two notes called "test": one at the root, one in Work. A link written
    // inside Work should mean the nearby one.
    const fs = new InMemoryFileSystem({
      [note('test.pad')]: 'root version',
      [note('Work', 'test.pad')]: 'work version',
      [note('Work', 'source.pad')]: 'see [[test]]',
    });

    expect(await index(fs).build(VAULT).then((g) => g.forward.get(note('Work', 'source.pad')))).toEqual(
      [note('Work', 'test.pad')],
    );
  });

  it('falls back to the shallowest match when none is in the same folder', async () => {
    // Deterministic, and independent of the order the vault was scanned in.
    const fs = new InMemoryFileSystem({
      [note('test.pad')]: 'root version',
      [note('Work', 'test.pad')]: 'work version',
      [note('Other', 'source.pad')]: 'see [[test]]',
    });

    expect(
      await index(fs).build(VAULT).then((g) => g.forward.get(note('Other', 'source.pad'))),
    ).toEqual([note('test.pad')]);
  });

  it('honours a path-qualified target, overriding proximity', async () => {
    // What autocomplete inserts for an ambiguous title. Without this the link
    // would resolve to the nearest same-named note rather than the one picked.
    const fs = new InMemoryFileSystem({
      [note('test.pad')]: 'root version',
      [note('Work', 'test.pad')]: 'work version',
      [note('Work', 'source.pad')]: 'see [[/test]]'.replace('/test', 'test'),
    });

    fs.seedFile(note('Work', 'source.pad'), 'see [[test]]');
    expect(await index(fs).build(VAULT).then((g) => g.forward.get(note('Work', 'source.pad')))).toEqual(
      [note('Work', 'test.pad')],
    );

    // Now qualified: the far one, explicitly.
    fs.seedFile(note('Work', 'source.pad'), 'see [[Other/test]]');
    fs.seedFile(note('Other', 'test.pad'), 'third version');

    expect(await index(fs).build(VAULT).then((g) => g.forward.get(note('Work', 'source.pad')))).toEqual(
      [note('Other', 'test.pad')],
    );
  });

  it('skips plumbing and unclaimed file types', async () => {
    const fs = new InMemoryFileSystem({
      [note('A.pad')]: '[[B]]',
      [note('B.pad')]: '',
      [note('README.md')]: '[[B]]',
      [note('.gitpad', 'config.json')]: '[[B]]',
    });

    // Only A links to B; the markdown file and the config are not notes.
    expect(await index(fs).build(VAULT).then((g) => g.backward.get(note('B.pad')))).toEqual([
      note('A.pad'),
    ]);
  });
});
