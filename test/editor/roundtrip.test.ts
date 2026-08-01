// @vitest-environment jsdom

import { Editor, defaultValueCtx, editorViewOptionsCtx, rootCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { getMarkdown } from '@milkdown/kit/utils';
import { describe, expect, it } from 'vitest';

/*
 * The round-trip guard.
 *
 * `.pad` files store markdown and the editor is a rich editor, so every save
 * runs markdown -> document -> markdown. Anything the editor cannot express
 * is silently dropped at that moment: the user types it, closes the note, and
 * it is gone. Plan 2.4 makes "every block must have a markdown form" a hard
 * rule; this is what enforces it.
 *
 * Runs the REAL Milkdown pipeline in jsdom, using the same commonmark and gfm
 * presets Crepe builds on -- markdown fidelity comes from those, not from the
 * UI features layered above them. Testing remark alone would prove nothing
 * about what the editor actually does.
 *
 * Every bug found in the wild should become a case here.
 */

async function roundTrip(markdown: string): Promise<string> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, document.createElement('div'));
      ctx.set(defaultValueCtx, markdown);
      // Editing is irrelevant here and an editable view schedules work jsdom
      // does not need to do.
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, editable: () => false }));
    })
    .use(commonmark)
    .use(gfm)
    .create();

  const result = editor.action(getMarkdown());

  await editor.destroy();

  return result;
}

/** Asserts the text survives unchanged, ignoring trailing-newline differences. */
async function expectStable(markdown: string): Promise<void> {
  expect((await roundTrip(markdown)).trimEnd()).toBe(markdown.trimEnd());
}

describe('markdown round trip', () => {
  it('preserves headings', async () => {
    await expectStable('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six');
  });

  it('preserves paragraphs and inline emphasis', async () => {
    await expectStable('Plain text with **bold**, *italic* and `code` in it.');
  });

  it('preserves links', async () => {
    await expectStable('A [link](https://example.com) inline.');
  });

  it('preserves images', async () => {
    await expectStable('![alt text](https://example.com/a.png)');
  });

  it('preserves ordered lists', async () => {
    await expectStable('1. first\n2. second\n3. third');
  });

  it('preserves block quotes', async () => {
    await expectStable('> quoted text');
  });

  it('preserves fenced code blocks and their language', async () => {
    await expectStable('```ts\nconst a = 1;\n```');
  });

  it('preserves code blocks with no language', async () => {
    await expectStable('```\nplain\n```');
  });

  it('preserves strikethrough', async () => {
    await expectStable('~~gone~~');
  });
});

/*
 * Blocks that survive but are REWRITTEN.
 *
 * These are recorded rather than tolerated. Nothing is lost, so the hard rule
 * in plan 2.4 holds -- but every one of them means opening and saving a note
 * rewrites it, producing a diff of changes the user did not make. Plan 2.3
 * calls for pinned serializer options precisely to stop that, and Milkdown
 * exposes `remarkPluginsCtx` to do it. Until then these assertions pin the
 * CURRENT behaviour, so a change from "reformatted" to "deleted" fails loudly.
 */
describe('markdown round trip: known normalisations', () => {
  it('rewrites thematic breaks as ***', async () => {
    expect((await roundTrip('before\n\n---\n\nafter')).trimEnd()).toBe('before\n\n***\n\nafter');
  });

  it('shortens table delimiter rows', async () => {
    const result = await roundTrip('| a | b |\n| --- | --- |\n| 1 | 2 |');

    // Content intact, delimiters minimised.
    expect(result).toContain('| a | b |');
    expect(result).toContain('| 1 | 2 |');
    expect(result).toContain('| - | - |');
  });

  it('loosens task lists with blank lines between items', async () => {
    const result = await roundTrip('* [ ] not done\n* [x] done');

    // The checkboxes themselves survive, which is what matters.
    expect(result).toContain('* [ ] not done');
    expect(result).toContain('* [x] done');
  });

  it('reflows nested bullet lists but keeps every item', async () => {
    const result = await roundTrip('* one\n* two\n  * nested\n  * also nested\n* three');

    for (const item of ['one', 'two', 'nested', 'also nested', 'three']) {
      expect(result).toContain(item);
    }
  });

  it('keeps every block of a combined document', async () => {
    // Individual blocks can each survive while their combination does not,
    // usually through the spacing between them.
    const result = await roundTrip(
      [
        '# Title',
        '',
        'Intro paragraph with **bold**.',
        '',
        '* [ ] a task',
        '',
        '> a quote',
        '',
        '```js',
        'code();',
        '```',
        '',
        '| a | b |',
        '| --- | --- |',
        '| 1 | 2 |',
      ].join('\n'),
    );

    for (const fragment of [
      '# Title',
      '**bold**',
      '* [ ] a task',
      '> a quote',
      '```js',
      'code();',
      '| a | b |',
    ]) {
      expect(result).toContain(fragment);
    }
  });

  it('does not lose content it cannot represent exactly', async () => {
    // Normalisation is acceptable -- silent deletion is not. Whatever the
    // formatting, the words must survive.
    const result = await roundTrip('Some text with <span>inline html</span> in it.');

    expect(result).toContain('Some text with');
    expect(result).toContain('in it.');
  });
});
