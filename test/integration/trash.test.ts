import * as assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Clock } from '../../src/core/ports/Clock';
import type { Logger } from '../../src/core/ports/Logger';
import { NoteService } from '../../src/core/vault/NoteService';
import { TrashService } from '../../src/core/vault/TrashService';
import { VaultLayout } from '../../src/core/vault/VaultLayout';
import { VsCodeFileSystem } from '../../src/platform/VsCodeFileSystem';

/*
 * Trash round trips against REAL files.
 *
 * The in-memory fake could not rename directories until this suite's unit
 * counterpart exposed it, which is exactly the class of gap a fake hides: the
 * folder cases passed while doing nothing. Restoring is the one operation
 * where being wrong loses someone's note, so it is verified on a real disk.
 */

const silent: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const clock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
};

const fs = new VsCodeFileSystem();

describe('Trash on the real filesystem', () => {
  let root: string;
  let layout: VaultLayout;
  let notes: NoteService;
  let trash: TrashService;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gitpad-trash-'));
    layout = new VaultLayout(root);
    notes = new NoteService(fs, clock, silent);
    trash = new TrashService(fs, clock, silent);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('restores a note to the folder it came from', async () => {
    await fsp.mkdir(path.join(root, 'Work'), { recursive: true });
    await fsp.writeFile(path.join(root, 'Work', 'Standup.pad'), 'contents');

    await notes.moveToTrash(layout, path.join(root, 'Work', 'Standup.pad'));

    const [entry] = await trash.list(layout);
    assert.equal(entry?.originalFolder, 'Work');

    const restored = await trash.restore(layout, entry!);

    assert.equal(restored, path.join(root, 'Work', 'Standup.pad'));
    assert.equal(await fsp.readFile(restored, 'utf8'), 'contents');
  });

  it('recreates a folder that was deleted after the note', async () => {
    await fsp.mkdir(path.join(root, 'Work'), { recursive: true });
    await fsp.writeFile(path.join(root, 'Work', 'Note.pad'), 'x');

    await notes.moveToTrash(layout, path.join(root, 'Work', 'Note.pad'));
    await fsp.rm(path.join(root, 'Work'), { recursive: true, force: true });

    const [entry] = await trash.list(layout);
    const restored = await trash.restore(layout, entry!);

    assert.equal(restored, path.join(root, 'Work', 'Note.pad'));
  });

  it('moves a whole folder to the trash and back', async () => {
    await fsp.mkdir(path.join(root, 'Work', 'Nested'), { recursive: true });
    await fsp.writeFile(path.join(root, 'Work', 'One.pad'), '1');
    await fsp.writeFile(path.join(root, 'Work', 'Nested', 'Two.pad'), '2');

    await notes.moveToTrash(layout, path.join(root, 'Work'));

    const entries = await trash.list(layout);
    assert.equal(entries.length, 1, 'a deleted folder is one entry, not its contents');
    assert.equal(entries[0]?.kind, 'folder');

    await trash.restore(layout, entries[0]!);

    assert.equal(await fsp.readFile(path.join(root, 'Work', 'One.pad'), 'utf8'), '1');
    assert.equal(
      await fsp.readFile(path.join(root, 'Work', 'Nested', 'Two.pad'), 'utf8'),
      '2',
    );
  });

  it('leaves no empty mirror folders behind', async () => {
    await fsp.mkdir(path.join(root, 'Work', 'Q1'), { recursive: true });
    await fsp.writeFile(path.join(root, 'Work', 'Q1', 'Note.pad'), 'x');

    await notes.moveToTrash(layout, path.join(root, 'Work', 'Q1', 'Note.pad'));
    await trash.restore(layout, (await trash.list(layout))[0]!);

    assert.equal(await fs.stat(path.join(layout.trashDir, 'Work')), undefined);
  });
});
