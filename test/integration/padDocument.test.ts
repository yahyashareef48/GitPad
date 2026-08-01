import * as assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { Logger } from '../../src/core/ports/Logger';
import { VsCodeFileSystem } from '../../src/platform/VsCodeFileSystem';
import { PadDocument } from '../../src/ui/editor/PadDocument';

/*
 * The document lifecycle, against real files.
 *
 * The backup path in particular cannot be covered by a unit test: the bug it
 * exists to prevent was passing a URI STRING to a path-based API, which only
 * misbehaves once a real filesystem tries to resolve it. In a fake it looks
 * like any other string.
 */

const silent: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const fs = new VsCodeFileSystem();
const noCancel = new vscode.CancellationTokenSource().token;

describe('PadDocument', () => {
  let root: string;
  let notePath: string;
  let noteUri: vscode.Uri;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gitpad-doc-'));
    notePath = path.join(root, 'note.pad');
    noteUri = vscode.Uri.file(notePath);
    await fsp.writeFile(notePath, 'original');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('loads the file from disk', async () => {
    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    assert.equal(document.text, 'original');
    assert.equal(document.isDirty, false);
  });

  it('becomes dirty on edit and clean on save', async () => {
    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    document.edit('changed');
    assert.equal(document.isDirty, true);

    await document.save(noCancel);

    assert.equal(document.isDirty, false);
    assert.equal(await fsp.readFile(notePath, 'utf8'), 'changed');
  });

  it('restores from a backup, and the backup id is a URI', async () => {
    // The reported bug: backupCustomDocument returns destination.toString(),
    // and treating that as a path yields "C:\file:\c%3A\Users\..." — which
    // makes the note permanently unopenable.
    const original = await PadDocument.create(noteUri, undefined, fs, silent);
    original.edit('unsaved work');

    const destination = vscode.Uri.file(path.join(root, 'backup-store'));
    const backup = await original.backup(destination, noCancel);

    assert.ok(backup.id.startsWith('file:'), `expected a URI id, got ${backup.id}`);

    const restored = await PadDocument.create(noteUri, backup.id, fs, silent);

    assert.equal(restored.text, 'unsaved work');
    // Dirty, because the recovered text differs from what is on disk — or the
    // recovered work could be discarded without a prompt.
    assert.equal(restored.isDirty, true);
  });

  it('falls back to the file when the backup is gone', async () => {
    // VS Code can hand back an id for a backup that has since been cleaned up.
    const staleId = vscode.Uri.file(path.join(root, 'never-written')).toString();

    const document = await PadDocument.create(noteUri, staleId, fs, silent);

    assert.equal(document.text, 'original');
    assert.equal(document.isDirty, false);
  });

  it('opens empty rather than failing when the file is missing', async () => {
    const missing = vscode.Uri.file(path.join(root, 'absent.pad'));

    const document = await PadDocument.create(missing, undefined, fs, silent);

    assert.equal(document.text, '');
  });

  it('undoes and redoes through the edit event', async () => {
    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    const events: vscode.CustomDocumentEditEvent<PadDocument>[] = [];
    document.onDidChangeDocument((event) => events.push(event));

    document.edit('first');
    document.edit('second');

    assert.equal(events.length, 2);

    events[1]?.undo();
    assert.equal(document.text, 'first');

    events[0]?.undo();
    assert.equal(document.text, 'original');

    events[0]?.redo();
    assert.equal(document.text, 'first');
  });

  it('ignores an edit that changes nothing, so undo has no empty steps', async () => {
    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    const events: unknown[] = [];
    document.onDidChangeDocument((event) => events.push(event));

    document.edit('original');

    assert.equal(events.length, 0);
  });

  it('reloads a clean document when the file changes on disk', async () => {
    // What a git pull looks like from an open editor's point of view.
    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    await fsp.writeFile(notePath, 'changed by someone else');

    assert.equal(await document.reloadFromDisk(), 'reloaded');
    assert.equal(document.text, 'changed by someone else');
    assert.equal(document.isDirty, false);
  });

  it('reports a conflict rather than discarding unsaved work', async () => {
    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    document.edit('my unsaved work');
    await fsp.writeFile(notePath, 'their version');

    assert.equal(await document.reloadFromDisk(), 'conflict');
    // Untouched: losing unsaved work to a background sync is unforgivable.
    assert.equal(document.text, 'my unsaved work');
  });

  it('treats our own save as unchanged, not as an external edit', async () => {
    // Saving fires the same watcher; content comparison is how we tell them
    // apart, rather than timestamp guesswork.
    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    document.edit('written by us');
    await document.save(noCancel);

    assert.equal(await document.reloadFromDisk(), 'unchanged');
    assert.equal(document.text, 'written by us');
  });

  it('keeps frontmatter out of the editor body', async () => {
    // Frontmatter reaching the editor is not cosmetic: `---` followed by text
    // is a setext heading, so the metadata renders as a giant document title.
    await fsp.writeFile(notePath, '---\ncreated: 2026-01-01\n---\nActual content\n');

    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    assert.equal(document.body, 'Actual content\n');
  });

  it('reattaches frontmatter byte-for-byte when the body is edited', async () => {
    // Including keys GitPad does not understand: a note from Obsidian must not
    // lose its tags by being opened here.
    await fsp.writeFile(notePath, '---\ntags: [a, b]\ncreated: 2026-01-01\n---\nold body\n');

    const document = await PadDocument.create(noteUri, undefined, fs, silent);
    document.editBody('new body\n');

    assert.equal(document.text, '---\ntags: [a, b]\ncreated: 2026-01-01\n---\nnew body\n');
  });

  it('stamps updated on save without disturbing other keys', async () => {
    await fsp.writeFile(notePath, '---\ntags: keep\nupdated: old\n---\nbody\n');

    const document = await PadDocument.create(noteUri, undefined, fs, silent);
    document.clock = { now: () => 0, nowIso: () => '2026-08-01T00:00:00.000Z' };

    document.editBody('changed\n');
    await document.save(noCancel);

    const written = await fsp.readFile(notePath, 'utf8');

    assert.match(written, /tags: keep/);
    assert.match(written, /updated: 2026-08-01T00:00:00\.000Z/);
    assert.doesNotMatch(written, /updated: old/);
  });

  it('does not add frontmatter to a note that has none', async () => {
    // Saving a plain note should not grow metadata it never had.
    await fsp.writeFile(notePath, 'just text\n');

    const document = await PadDocument.create(noteUri, undefined, fs, silent);
    document.clock = { now: () => 0, nowIso: () => '2026-08-01T00:00:00.000Z' };

    document.editBody('still just text\n');
    await document.save(noCancel);

    assert.equal(await fsp.readFile(notePath, 'utf8'), 'still just text\n');
  });

  it('reverts to what is on disk', async () => {
    const document = await PadDocument.create(noteUri, undefined, fs, silent);

    document.edit('changed');
    await document.revert();

    assert.equal(document.text, 'original');
    assert.equal(document.isDirty, false);
  });
});
