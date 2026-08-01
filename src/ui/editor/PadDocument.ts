import * as vscode from 'vscode';

import type { FileSystem } from '../../core/ports/FileSystem';

/*
 * The in-memory state of one open `.pad` file.
 *
 * GitPad uses CustomEditorProvider with its own document type rather than
 * CustomTextEditorProvider, so this class owns what a TextDocument would
 * normally own: the content, the dirty state, and the undo stack (plan 1.4).
 *
 * The reason is undo. A rich editor keeps its own history, and routing every
 * keystroke through a TextDocument means two undo stacks competing for Ctrl+Z.
 * Owning the document lets us forward VS Code's undo into the editor's history
 * instead of fighting it.
 */

/**
 * One undoable change.
 *
 * Both sides of the change are captured, so undo and redo are symmetric and
 * neither has to reconstruct anything.
 */
interface PadEdit {
  readonly before: string;
  readonly after: string;
}

export class PadDocument implements vscode.CustomDocument {
  private currentText: string;
  private savedText: string;

  /** Fires when content changes for any reason; the webview re-renders. */
  private readonly contentChanged = new vscode.EventEmitter<string>();
  public readonly onDidChangeContent = this.contentChanged.event;

  /**
   * Fires to tell VS Code an undoable edit happened.
   *
   * VS Code owns the undo POSITION -- it decides when to call undo and redo.
   * We only supply what to do when it does.
   */
  private readonly documentChanged = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<PadDocument>
  >();
  public readonly onDidChangeDocument = this.documentChanged.event;

  private constructor(
    public readonly uri: vscode.Uri,
    private readonly fs: FileSystem,
    text: string,
  ) {
    this.currentText = text;
    this.savedText = text;
  }

  public static async create(
    uri: vscode.Uri,
    backupId: string | undefined,
    fs: FileSystem,
  ): Promise<PadDocument> {
    /*
     * A backup takes precedence over the file on disk.
     *
     * VS Code passes one when the window is reopened after closing with
     * unsaved changes (hot exit). Reading the file instead would silently
     * discard exactly the work the backup exists to protect.
     */
    const source = backupId ?? uri.fsPath;
    const text = await readText(fs, source);

    const document = new PadDocument(uri, fs, text);

    // Restored-from-backup content differs from what is on disk, so the
    // document must open dirty or the difference could be lost without a
    // prompt.
    if (backupId !== undefined) {
      document.savedText = await readText(fs, uri.fsPath).catch(() => '');
    }

    return document;
  }

  public get text(): string {
    return this.currentText;
  }

  public get isDirty(): boolean {
    return this.currentText !== this.savedText;
  }

  /**
   * Records a change made by the user, and tells VS Code it is undoable.
   *
   * Does NOT notify the webview: the change came from there, and echoing it
   * back would move the caret and fight the person typing.
   */
  public edit(text: string, label = 'Edit'): void {
    if (text === this.currentText) {
      return;
    }

    const change: PadEdit = { before: this.currentText, after: text };
    this.currentText = text;

    this.documentChanged.fire({
      document: this,
      label,
      undo: () => {
        this.currentText = change.before;
        this.contentChanged.fire(this.currentText);
      },
      redo: () => {
        this.currentText = change.after;
        this.contentChanged.fire(this.currentText);
      },
    });
  }

  /**
   * Replaces the content without creating an undo entry.
   *
   * For changes that did not come from the user typing -- reverting, or the
   * file changing on disk. Recording those as edits would let Ctrl+Z step
   * back into a state the file never had.
   */
  public replace(text: string): void {
    if (text === this.currentText) {
      return;
    }

    this.currentText = text;
    this.contentChanged.fire(text);
  }

  public async save(cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveAs(this.uri, cancellation);
    this.savedText = this.currentText;
  }

  public async saveAs(
    target: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    // The text is captured before the await so a keystroke landing mid-write
    // cannot be silently included in, or excluded from, this save.
    const snapshot = this.currentText;

    if (cancellation.isCancellationRequested) {
      return;
    }

    await this.fs.writeFile(target.fsPath, new TextEncoder().encode(snapshot));
  }

  public async revert(): Promise<void> {
    const onDisk = await readText(this.fs, this.uri.fsPath);

    this.savedText = onDisk;
    this.replace(onDisk);
  }

  public async backup(
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    await this.saveAs(destination, cancellation);

    return {
      id: destination.toString(),
      delete: async () => {
        // Best effort: a backup that cannot be deleted is harmless clutter,
        // and throwing here would surface as a spurious error to the user.
        try {
          await this.fs.delete(destination.fsPath);
        } catch {
          /* ignore */
        }
      },
    };
  }

  public dispose(): void {
    this.contentChanged.dispose();
    this.documentChanged.dispose();
  }
}

async function readText(fs: FileSystem, fsPath: string): Promise<string> {
  return new TextDecoder().decode(await fs.readFile(fsPath));
}
