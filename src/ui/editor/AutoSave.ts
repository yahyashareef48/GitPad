import * as vscode from 'vscode';

import type { Logger } from '../../core/ports/Logger';

/*
 * Saves notes automatically, shortly after typing stops.
 *
 * This has to exist because VS Code's own `files.autoSave` applies to text
 * documents and NOT to custom editors -- so a `.pad` file would only ever be
 * written when the user pressed Ctrl+S, whatever their editor settings say.
 *
 * For a notes app that is the wrong default. Nobody expects to save a note,
 * and in Phase 2 the sync scheduler waits for files to be written before it
 * commits, so manual saving would quietly make sync look broken too.
 *
 * `vscode.workspace.save()` is used rather than writing the file directly:
 * saving behind VS Code's back leaves the tab showing a dirty indicator for a
 * document that is already on disk.
 */
export class AutoSave implements vscode.Disposable {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  public constructor(private readonly logger: Logger) {}

  public get enabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>('gitpad.editor.autoSave', true);
  }

  private get delayMs(): number {
    return Math.max(
      200,
      vscode.workspace.getConfiguration().get<number>('gitpad.editor.autoSaveDelayMs', 800),
    );
  }

  /**
   * Schedules a save, restarting the timer on each call.
   *
   * Debounced rather than saving per edit: a burst of typing should produce
   * one write, not one per keystroke, both to spare the disk and -- once sync
   * exists -- to avoid a commit per character.
   */
  public schedule(uri: vscode.Uri): void {
    if (!this.enabled) {
      return;
    }

    const key = uri.toString();
    this.cancel(uri);

    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        void this.saveNow(uri);
      }, this.delayMs),
    );
  }

  /** Saves immediately if a save was pending. Used when a note is closing. */
  public async flush(uri: vscode.Uri): Promise<void> {
    if (this.pending.has(uri.toString())) {
      this.cancel(uri);
      await this.saveNow(uri);
    }
  }

  public cancel(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = this.pending.get(key);

    if (timer !== undefined) {
      clearTimeout(timer);
      this.pending.delete(key);
    }
  }

  public dispose(): void {
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }

    this.pending.clear();
  }

  private async saveNow(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.save(uri);
    } catch (error) {
      /*
       * Never surfaced as a dialog.
       *
       * Auto-save runs constantly and unprompted; a modal for a transient
       * failure -- a file briefly locked, a drive reconnecting -- would
       * interrupt someone mid-sentence. The document stays dirty, so the
       * change is not lost and the next attempt will retry.
       */
      this.logger.warn(`Auto-save failed for ${uri.fsPath}`, error);
    }
  }
}
