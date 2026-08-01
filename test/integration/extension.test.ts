import * as assert from 'node:assert/strict';

import * as vscode from 'vscode';

/*
 * Proves the extension is wired into VS Code correctly. These assertions cannot
 * be made from a unit test: they are about the manifest and the host, not about
 * our own logic.
 */

const EXTENSION_ID = 'YahyaShareef.gitpad';

describe('GitPad extension', () => {
  it('is installed and activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `extension ${EXTENSION_ID} was not found`);

    await extension.activate();

    assert.equal(extension.isActive, true);
  });

  it('contributes the sidebar view into its own activity bar container', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension);

    const contributes = extension.packageJSON.contributes;

    const containers = contributes?.viewsContainers?.activitybar ?? [];
    assert.ok(
      containers.some((container: { id: string }) => container.id === 'gitpad'),
      'expected a "gitpad" activity bar container',
    );

    // The view id must match SidebarViewProvider.viewType, or the view renders
    // as a permanently empty panel with no error anywhere.
    const views = contributes?.views?.gitpad ?? [];
    assert.ok(
      views.some((view: { id: string }) => view.id === 'gitpad.sidebar'),
      'expected a "gitpad.sidebar" view',
    );
  });
});
