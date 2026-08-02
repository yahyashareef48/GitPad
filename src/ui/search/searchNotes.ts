import * as vscode from 'vscode';

import type { Logger } from '../../core/ports/Logger';
import type { SearchHit, SearchIndex } from '../../core/search/SearchIndex';
import { PadEditorProvider } from '../editor/PadEditorProvider';
import type { VaultController } from '../vault/VaultController';

/*
 * Full-text search, as a Quick Pick.
 *
 * Deliberately NOT in the sidebar. The sidebar's box filters the tree by title
 * and must stay instant; full-text results are a different thing -- a ranked
 * list with excerpts, which wants the width and keyboard handling a Quick Pick
 * already has, and which would push the tree off screen if shown inline.
 */

interface HitItem extends vscode.QuickPickItem {
  readonly hit: SearchHit;
}

export async function searchNotes(
  vault: VaultController,
  index: SearchIndex,
  logger: Logger,
): Promise<void> {
  const state = vault.state;

  if (state.kind !== 'ready') {
    void vscode.window.showInformationMessage('Open a vault first.');

    return;
  }

  const picker = vscode.window.createQuickPick<HitItem>();

  picker.placeholder = 'Search note contents';
  /*
   * VS Code's own filtering is off.
   *
   * It would re-filter our ranked results by its own fuzzy rules, discarding
   * the ordering that puts title matches first -- and it cannot match text
   * found inside a note that is not in the label.
   */
  picker.matchOnDescription = false;
  picker.matchOnDetail = false;
  picker.busy = true;
  picker.show();

  try {
    /*
     * Rebuilt per invocation rather than kept warm.
     *
     * A vault is small, notes change constantly, and a stale result that opens
     * a note which no longer says what you searched for is worse than waiting
     * a moment.
     */
    await index.build(state.root);
  } catch (error) {
    logger.error('Could not build the search index', error);
    picker.hide();
    void vscode.window.showErrorMessage('Could not search the vault.');

    return;
  }

  picker.busy = false;

  picker.onDidChangeValue((value) => {
    picker.items = index.search(value).map((hit) => ({
      label: hit.title,
      description: hit.excerpt,
      hit,
    }));
  });

  picker.onDidAccept(() => {
    const selected = picker.selectedItems[0];

    picker.hide();

    if (selected !== undefined) {
      void vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(selected.hit.id),
        PadEditorProvider.viewType,
      );
    }
  });

  picker.onDidHide(() => {
    picker.dispose();
  });
}
