import * as path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Logger } from '../../src/core/ports/Logger';
import { SearchIndex } from '../../src/core/search/SearchIndex';
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

async function indexOf(files: Record<string, string>): Promise<SearchIndex> {
  const fs = new InMemoryFileSystem(files);
  fs.seedDirectory(VAULT);

  const index = new SearchIndex(fs, silentLogger, EXTENSIONS);
  await index.build(VAULT);

  return index;
}

describe('SearchIndex', () => {
  let index: SearchIndex;

  beforeEach(async () => {
    index = await indexOf({
      [note('Budget.pad')]: 'Numbers for the quarter.',
      [note('Standup.pad')]: 'We discussed the budget and the timeline.',
      [note('Work', 'Retro.pad')]: 'What went well.\nThe budget was tight.',
      [note('Frontmatter.pad')]: '---\ncreated: 2026-01-01\n---\nActual content here.',
    });
  });

  it('finds notes by their contents', async () => {
    const hits = await index.search('timeline');

    expect(hits.map((hit) => hit.title)).toEqual(['Standup']);
  });

  it('ranks a title match above a passing mention', async () => {
    // Someone searching "budget" almost always wants the note CALLED budget.
    expect((await index.search('budget'))[0]?.title).toBe('Budget');
  });

  it('requires every term, but not adjacently', async () => {
    // "went budget" appears in Retro across two different lines.
    expect((await index.search('went budget')).map((hit) => hit.title)).toEqual(['Retro']);

    expect(await index.search('budget nonexistent')).toEqual([]);
  });

  it('ignores case', async () => {
    expect((await index.search('BUDGET')).length).toBeGreaterThan(0);
  });

  it('returns an excerpt containing the match', async () => {
    const [hit] = await index.search('timeline');

    expect(hit?.excerpt).toContain('timeline');
  });

  it('does not search frontmatter', async () => {
    // Otherwise searching "created" would return every note ever made.
    expect(await index.search('created')).toEqual([]);
    expect((await index.search('Actual content')).map((hit) => hit.title)).toEqual(['Frontmatter']);
  });

  it('searches notes in subfolders', async () => {
    expect((await index.search('went well')).map((hit) => hit.title)).toEqual(['Retro']);
  });

  it('returns nothing for an empty query', async () => {
    expect(await index.search('')).toEqual([]);
    expect(await index.search('   ')).toEqual([]);
  });

  it('skips plumbing and unclaimed file types', async () => {
    const other = await indexOf({
      [note('Note.pad')]: 'findme',
      [note('README.md')]: 'findme',
      [note('.gitpad', 'config.json')]: 'findme',
    });

    expect((await other.search('findme')).map((hit) => hit.title)).toEqual(['Note']);
  });
});
