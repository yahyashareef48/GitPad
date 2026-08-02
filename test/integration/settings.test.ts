import * as assert from 'node:assert/strict';

import * as vscode from 'vscode';

/*
 * Proves the vault path actually persists.
 *
 * Reported symptom: GitPad asks for a vault again after every reload. That has
 * two very different causes -- the write silently failing, or the read looking
 * in the wrong place -- and they are indistinguishable from the outside.
 *
 * This exercises the exact calls VaultController makes, so whichever half is
 * broken fails here rather than a session later.
 */

const SETTING = 'gitpad.vault.path';

describe('vault path persistence', () => {
  afterEach(async () => {
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, undefined, vscode.ConfigurationTarget.Global);
  });

  it('reads back what it writes, through an unsectioned configuration', async () => {
    // Exactly VaultController's call shape: no section, full dotted key.
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, 'C:\\vaults\\notes', vscode.ConfigurationTarget.Global);

    const readBack = vscode.workspace.getConfiguration().get<string>(SETTING);

    assert.equal(readBack, 'C:\\vaults\\notes');
  });

  it('reads back the same value through a sectioned configuration', async () => {
    // If these two disagree, the write and the read are addressing different
    // keys -- which is precisely the "asks again every reload" symptom.
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, 'C:\\vaults\\other', vscode.ConfigurationTarget.Global);

    assert.equal(
      vscode.workspace.getConfiguration('gitpad.vault').get<string>('path'),
      'C:\\vaults\\other',
    );
  });

  it('defaults to an empty string when never set', async () => {
    await vscode.workspace
      .getConfiguration()
      .update(SETTING, undefined, vscode.ConfigurationTarget.Global);

    assert.equal(vscode.workspace.getConfiguration().get<string>(SETTING), '');
  });
});
