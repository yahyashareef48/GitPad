import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RecentlyOpened } from '../../src/ui/vault/RecentlyOpened';

/*
 * RecentlyOpened imports vscode only as a TYPE, so it is erased at runtime and
 * these tests run in plain Node -- no extension host needed.
 */

const VAULT = path.resolve('/vaults/notes');

/** Minimal stand-in for vscode.Memento. */
function memento(initial: unknown = undefined) {
  let stored = initial;

  return {
    get: <T>(): T | undefined => stored as T | undefined,
    update: async (_key: string, value: unknown) => {
      stored = value;
    },
    keys: () => [],
  };
}

const note = (name: string) => path.join(VAULT, `${name}.pad`);

describe('RecentlyOpened', () => {
  it('lists newest first', async () => {
    const recent = new RecentlyOpened(memento(), () => 5);

    await recent.record(note('a'));
    await recent.record(note('b'));

    expect(recent.list(VAULT).map((item) => item.name)).toEqual(['b', 'a']);
  });

  it('moves a re-opened note to the front instead of duplicating it', async () => {
    const recent = new RecentlyOpened(memento(), () => 5);

    await recent.record(note('a'));
    await recent.record(note('b'));
    await recent.record(note('a'));

    expect(recent.list(VAULT).map((item) => item.name)).toEqual(['a', 'b']);
  });

  it('honours the limit', async () => {
    const recent = new RecentlyOpened(memento(), () => 2);

    await recent.record(note('a'));
    await recent.record(note('b'));
    await recent.record(note('c'));

    expect(recent.list(VAULT).map((item) => item.name)).toEqual(['c', 'b']);
  });

  it('returns nothing when the limit is zero, which hides the section', async () => {
    let limit = 5;
    const recent = new RecentlyOpened(memento(), () => limit);

    await recent.record(note('a'));
    expect(recent.list(VAULT)).toHaveLength(1);

    // Read on every call, so changing the setting takes effect immediately
    // rather than after a reload.
    limit = 0;
    expect(recent.list(VAULT)).toEqual([]);
  });

  it('treats a negative limit as zero', () => {
    expect(new RecentlyOpened(memento(), () => -1).list(VAULT)).toEqual([]);
  });

  it('excludes notes belonging to a different vault', async () => {
    const recent = new RecentlyOpened(memento(), () => 5);

    await recent.record(note('mine'));
    await recent.record(path.resolve('/elsewhere/theirs.pad'));

    expect(recent.list(VAULT).map((item) => item.name)).toEqual(['mine']);
  });

  it('forgets an entry, so a deleted note stops being offered', async () => {
    const recent = new RecentlyOpened(memento(), () => 5);

    await recent.record(note('gone'));
    await recent.forget(note('gone'));

    expect(recent.list(VAULT)).toEqual([]);
  });

  it('survives stored state that is not the expected shape', () => {
    // globalState outlives upgrades, so its contents are not guaranteed.
    expect(new RecentlyOpened(memento('nonsense'), () => 5).list(VAULT)).toEqual([]);
    expect(new RecentlyOpened(memento([1, 2]), () => 5).list(VAULT)).toEqual([]);
  });
});
