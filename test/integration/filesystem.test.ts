import * as assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Logger } from '../../src/core/ports/Logger';
import { VaultTree } from '../../src/core/vault/VaultTree';
import { VsCodeFileSystem } from '../../src/platform/VsCodeFileSystem';

/*
 * Exercises the REAL filesystem adapter against a REAL directory.
 *
 * The unit tests all run against InMemoryFileSystem, which proves the domain
 * logic but says nothing about whether VsCodeFileSystem behaves the way the
 * port promises. That gap is exactly where a "the sidebar is empty" bug hides:
 * every unit test passes while nothing works.
 */

const collected: string[] = [];

const collectingLogger: Logger = {
  debug: (message) => collected.push(`debug ${message}`),
  info: (message) => collected.push(`info ${message}`),
  warn: (message) => collected.push(`warn ${message}`),
  error: (message) => collected.push(`error ${message}`),
};

describe('VsCodeFileSystem', () => {
  let root: string;
  const fs = new VsCodeFileSystem();

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gitpad-test-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('stats an existing directory', async () => {
    const stat = await fs.stat(root);

    assert.equal(stat?.kind, 'directory');
  });

  it('returns undefined for a missing path rather than throwing', async () => {
    assert.equal(await fs.stat(path.join(root, 'nope')), undefined);
  });

  it('lists files it wrote', async () => {
    await fsp.writeFile(path.join(root, 'test.pad'), 'hello');

    const entries = await fs.readDirectory(root);

    assert.deepEqual(
      entries.map((entry) => [entry.name, entry.kind]),
      [['test.pad', 'file']],
    );
  });

  it('distinguishes directories from files', async () => {
    await fsp.mkdir(path.join(root, 'Work'));
    await fsp.writeFile(path.join(root, 'note.pad'), '');

    const entries = await fs.readDirectory(root);
    const byName = new Map(entries.map((entry) => [entry.name, entry.kind]));

    // Compared as a map: readDirectory promises no particular order, and
    // asserting one makes the test fail for reasons unrelated to what it
    // covers.
    assert.equal(byName.size, 2);
    assert.equal(byName.get('Work'), 'directory');
    assert.equal(byName.get('note.pad'), 'file');
  });

  it('round-trips file contents', async () => {
    const target = path.join(root, 'sub', 'deep.pad');

    await fs.writeFile(target, new TextEncoder().encode('written by the port'));

    assert.equal(new TextDecoder().decode(await fs.readFile(target)), 'written by the port');
  });
});

describe('VaultTree over the real filesystem', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gitpad-tree-'));
    collected.length = 0;
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  const build = () =>
    new VaultTree(new VsCodeFileSystem(), collectingLogger, new Set(['.pad'])).build(root);

  it('finds a single note at the vault root', async () => {
    // The exact reported scenario: one .pad file, nothing else.
    await fsp.writeFile(path.join(root, 'test.pad'), '');

    const nodes = await build();

    assert.equal(nodes.length, 1, `expected one node, got ${JSON.stringify(nodes)}`);
    assert.equal(nodes[0]?.name, 'test');
    assert.equal(nodes[0]?.kind, 'document');
  });

  it('nests notes inside folders', async () => {
    await fsp.mkdir(path.join(root, 'Work'));
    await fsp.writeFile(path.join(root, 'Work', 'Standup.pad'), '');

    const nodes = await build();

    assert.equal(nodes.length, 1);
    assert.equal(nodes[0]?.kind, 'folder');
    assert.equal(nodes[0]?.children?.[0]?.name, 'Standup');
  });

  it('excludes plumbing and unclaimed types', async () => {
    await fsp.writeFile(path.join(root, 'keep.pad'), '');
    await fsp.writeFile(path.join(root, 'README.md'), '');
    await fsp.mkdir(path.join(root, '.gitpad'));

    const nodes = await build();

    assert.deepEqual(
      nodes.map((node) => node.name),
      ['keep'],
    );
  });
});
