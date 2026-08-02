import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/core/ports/Clock';
import type { Logger } from '../../src/core/ports/Logger';
import { CURRENT_SCHEMA_VERSION, parseVaultConfig } from '../../src/core/vault/VaultConfig';
import { VaultLayout } from '../../src/core/vault/VaultLayout';
import { VaultService } from '../../src/core/vault/VaultService';
import { detectVaultCandidate } from '../../src/core/vault/detectVaultCandidate';
import { InMemoryFileSystem } from './support/InMemoryFileSystem';

const VAULT = path.resolve('/vaults/notes');
const CONFIG = '{"schemaVersion":1,"createdAt":"2026-08-01T00:00:00.000Z"}';

const fixedClock: Clock = {
  now: () => 0,
  nowIso: () => '2026-08-01T00:00:00.000Z',
};

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('VaultLayout', () => {
  const layout = new VaultLayout(VAULT);

  it('places metadata, config and trash at their well-known paths', () => {
    expect(layout.metadataDir).toBe(path.join(VAULT, '.gitpad'));
    expect(layout.configPath).toBe(path.join(VAULT, '.gitpad', 'config.json'));
    expect(layout.trashDir).toBe(path.join(VAULT, '.trash'));
  });

  it('accepts paths inside the vault', () => {
    expect(layout.contains(path.join(VAULT, 'note.pad'))).toBe(true);
    expect(layout.contains(path.join(VAULT, 'work', 'deep', 'note.pad'))).toBe(true);
  });

  it('rejects the vault root itself, which is never a write target', () => {
    expect(layout.contains(VAULT)).toBe(false);
  });

  it('rejects escapes, however they are spelled', () => {
    expect(layout.contains(path.join(VAULT, '..', 'elsewhere.pad'))).toBe(false);
    expect(layout.contains(path.resolve('/etc/passwd'))).toBe(false);
    expect(layout.contains(path.join(VAULT, 'a', '..', '..', 'b'))).toBe(false);
  });

  it('accepts filenames that merely begin with dots', () => {
    // A prefix check on ".." rejects these, which are ordinary files inside
    // the vault -- ".. .. escape" is what the title sanitiser produces from
    // "../../escape", and it is harmless.
    expect(layout.contains(path.join(VAULT, '..hidden.pad'))).toBe(true);
    expect(layout.contains(path.join(VAULT, '.. .. escape.pad'))).toBe(true);
    expect(layout.contains(path.join(VAULT, '...pad'))).toBe(true);
  });
});

describe('parseVaultConfig', () => {
  it('reads a well-formed config', () => {
    expect(parseVaultConfig(CONFIG)).toEqual({
      schemaVersion: 1,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('keeps the foreign-repo consent flag when set', () => {
    const raw = '{"schemaVersion":1,"createdAt":"x","adoptedForeignRepo":true}';

    expect(parseVaultConfig(raw)?.adoptedForeignRepo).toBe(true);
  });

  it('degrades to undefined rather than throwing on damaged input', () => {
    // A stray character in a JSON file must not stop the extension starting.
    expect(parseVaultConfig('not json')).toBeUndefined();
    expect(parseVaultConfig('{}')).toBeUndefined();
    expect(parseVaultConfig('null')).toBeUndefined();
    expect(parseVaultConfig('{"schemaVersion":"1","createdAt":"x"}')).toBeUndefined();
  });
});

describe('detectVaultCandidate', () => {
  it('reports a plain folder as new', async () => {
    const fs = new InMemoryFileSystem();
    fs.seedDirectory(VAULT);

    expect(await detectVaultCandidate(VAULT, fs)).toEqual({ kind: 'new' });
  });

  it('recognises an existing vault that is not yet under git', async () => {
    const fs = new InMemoryFileSystem({ [path.join(VAULT, '.gitpad', 'config.json')]: CONFIG });

    expect(await detectVaultCandidate(VAULT, fs)).toEqual({ kind: 'vault', root: VAULT });
  });

  it('recognises a vault at its own repository root', async () => {
    const fs = new InMemoryFileSystem({ [path.join(VAULT, '.gitpad', 'config.json')]: CONFIG });
    fs.seedDirectory(path.join(VAULT, '.git'));

    expect(await detectVaultCandidate(VAULT, fs)).toEqual({ kind: 'vault', root: VAULT });
  });

  it('flags a folder sitting inside someone else’s repository', async () => {
    // The common mistake: picking myapp/notes, which has no .git of its own.
    const project = path.resolve('/code/myapp');
    const notes = path.join(project, 'notes');

    const fs = new InMemoryFileSystem();
    fs.seedDirectory(path.join(project, '.git'));
    fs.seedDirectory(notes);

    expect(await detectVaultCandidate(notes, fs)).toEqual({
      kind: 'foreign-repo',
      repoRoot: project,
    });
  });

  it('detects a repository marked by a .git FILE, as worktrees and submodules are', async () => {
    const project = path.resolve('/code/worktree');
    const fs = new InMemoryFileSystem({ [path.join(project, '.git')]: 'gitdir: ../real/.git' });
    fs.seedDirectory(path.join(project, 'notes'));

    expect(await detectVaultCandidate(path.join(project, 'notes'), fs)).toEqual({
      kind: 'foreign-repo',
      repoRoot: project,
    });
  });

  it('still flags a vault nested inside a foreign repository', async () => {
    // Sync operates on the whole repository, not a subdirectory, so committing
    // here would sweep up the surrounding project.
    const project = path.resolve('/code/myapp');
    const notes = path.join(project, 'notes');

    const fs = new InMemoryFileSystem({
      [path.join(notes, '.gitpad', 'config.json')]: CONFIG,
    });
    fs.seedDirectory(path.join(project, '.git'));

    expect(await detectVaultCandidate(notes, fs)).toEqual({
      kind: 'foreign-repo',
      repoRoot: project,
    });
  });
});

describe('VaultService.initialize', () => {
  const service = (fs: InMemoryFileSystem) => new VaultService(fs, fixedClock, silentLogger);

  it('creates config, trash and gitignore', async () => {
    const fs = new InMemoryFileSystem();

    const layout = await service(fs).initialize(VAULT);

    expect(fs.has(layout.configPath)).toBe(true);
    expect(fs.has(layout.gitignorePath)).toBe(true);
    expect(await fs.stat(layout.trashDir)).toMatchObject({ kind: 'directory' });

    expect(JSON.parse(fs.read(layout.configPath))).toEqual({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('records foreign-repo consent when given', async () => {
    const fs = new InMemoryFileSystem();

    const layout = await service(fs).initialize(VAULT, { adoptedForeignRepo: true });

    expect(JSON.parse(fs.read(layout.configPath)).adoptedForeignRepo).toBe(true);
  });

  it('leaves an existing config alone', async () => {
    const original = '{"schemaVersion":1,"createdAt":"2020-01-01T00:00:00.000Z"}';
    const fs = new InMemoryFileSystem({ [path.join(VAULT, '.gitpad', 'config.json')]: original });

    const layout = await service(fs).initialize(VAULT);

    expect(JSON.parse(fs.read(layout.configPath)).createdAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('never overwrites a .gitignore the user already has', async () => {
    const fs = new InMemoryFileSystem({ [path.join(VAULT, '.gitignore')]: 'node_modules\n' });

    const layout = await service(fs).initialize(VAULT);

    expect(fs.read(layout.gitignorePath)).toBe('node_modules\n');
  });

  it('is safe to run twice, so an interrupted first run heals', async () => {
    const fs = new InMemoryFileSystem();
    const vault = service(fs);

    await vault.initialize(VAULT);
    await vault.initialize(VAULT);

    expect((await vault.readConfig(VAULT))?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});
