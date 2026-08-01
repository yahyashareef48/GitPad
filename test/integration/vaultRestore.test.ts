import * as assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import type { Logger } from '../../src/core/ports/Logger';
import { VaultService } from '../../src/core/vault/VaultService';
import { SystemClock } from '../../src/platform/SystemClock';
import { VsCodeFileSystem } from '../../src/platform/VsCodeFileSystem';
import { VaultController } from '../../src/ui/vault/VaultController';

/*
 * Reproduces "GitPad asks for a vault again after every reload".
 *
 * Reload is really: activate, read the saved path, reopen it. This exercises
 * that path directly with the real filesystem and the real settings store, so
 * a failure lands here instead of in a screenshot.
 */

const SETTING = 'gitpad.vault.path';

const lines: string[] = [];

const recordingLogger: Logger = {
  debug: (message) => lines.push(`debug ${message}`),
  info: (message) => lines.push(`info ${message}`),
  warn: (message) => lines.push(`warn ${message}`),
  error: (message) => lines.push(`error ${message}`),
};

function controller(): VaultController {
  const fs = new VsCodeFileSystem();

  return new VaultController(fs, new VaultService(fs, new SystemClock(), recordingLogger), recordingLogger);
}

describe('VaultController.restore', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'gitpad-restore-'));
    lines.length = 0;
  });

  afterEach(async () => {
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, undefined, vscode.ConfigurationTarget.Global);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('reports loading, not no-vault, before restore finishes', async () => {
    // The reported bug. The sidebar asks for state the instant it is revealed,
    // which on a reload is before restore() has touched the disk. Answering
    // "no-vault" there shows the welcome screen to someone who has a vault --
    // and acting on it makes them pick one again.
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, root, vscode.ConfigurationTarget.Global);

    const vault = controller();

    assert.equal(vault.state.kind, 'loading');

    const restoring = vault.restore();
    assert.equal(vault.state.kind, 'loading', 'must not report no-vault mid-restore');

    await restoring;
    assert.equal(vault.state.kind, 'ready');

    vault.dispose();
  });

  it('leaves the loading state even when there is no saved vault', async () => {
    // Otherwise the sidebar sits on "loading" forever for a brand-new user.
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, undefined, vscode.ConfigurationTarget.Global);

    const vault = controller();
    await vault.restore();

    assert.equal(vault.state.kind, 'no-vault');
    vault.dispose();
  });

  it('reopens the saved vault, which is what a reload does', async () => {
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, root, vscode.ConfigurationTarget.Global);

    const vault = controller();
    await vault.restore();

    assert.equal(
      vault.state.kind,
      'ready',
      `expected the vault to reopen. Log:\n${lines.join('\n')}`,
    );
    vault.dispose();
  });

  it('survives a full save-then-restore cycle', async () => {
    // First session: user picks a vault, which writes the setting.
    const first = controller();
    await first.openForTesting(root);
    assert.equal(first.state.kind, 'ready');
    first.dispose();

    // Second session: a fresh controller, as after a reload.
    const second = controller();
    await second.restore();

    assert.equal(
      second.state.kind,
      'ready',
      `vault did not survive the cycle. Log:\n${lines.join('\n')}`,
    );
    second.dispose();
  });

  it('shows the welcome screen when the saved folder is gone', async () => {
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, path.join(root, 'deleted'), vscode.ConfigurationTarget.Global);

    const vault = controller();
    await vault.restore();

    assert.equal(vault.state.kind, 'no-vault');
    vault.dispose();
  });
});
