import * as path from 'node:path';

import * as vscode from 'vscode';

import type { LinkRenamer } from '../../core/links/LinkRenamer';

/*
 * Keeps `[[wikilinks]]` working when a note is renamed.
 *
 * Split into two steps ON PURPOSE. The backlink graph resolves links to the
 * files they point at, so once the rename has happened the old path no longer
 * exists and nothing resolves to it -- asking afterwards always finds zero
 * notes. The affected set has to be captured first.
 */

/** Notes linking to `oldPath`. Must be called BEFORE the rename. */
export async function findLinkingNotes(
  renamer: LinkRenamer,
  vaultRoot: string,
  oldPath: string,
): Promise<readonly string[]> {
  try {
    return (await renamer.preview(vaultRoot, oldPath)).affected;
  } catch {
    // A rename must not fail because the index could not be built.
    return [];
  }
}

/**
 * Offers to repoint those links at the new name.
 *
 * Asks rather than acting. Rewriting someone's other notes is correct here,
 * but it is still an edit they did not make, and plan 2.5 calls for a prompt.
 * Silently editing files is how a tool loses trust it does not get back.
 */
export async function offerLinkUpdate(
  renamer: LinkRenamer,
  affected: readonly string[],
  oldPath: string,
  newPath: string,
): Promise<void> {
  const oldTitle = path.parse(oldPath).name;

  if (affected.length === 0 || oldTitle === path.parse(newPath).name) {
    return;
  }

  const count = `${affected.length} note${affected.length === 1 ? '' : 's'}`;
  const update = `Update ${count}`;

  const choice = await vscode.window.showInformationMessage(
    `${count} link to “${oldTitle}”. Point them at the new name?`,
    update,
  );

  if (choice !== update) {
    return;
  }

  const changed = await renamer.apply(affected, oldPath, newPath);

  void vscode.window.showInformationMessage(
    `Updated links in ${changed} note${changed === 1 ? '' : 's'}.`,
  );
}
