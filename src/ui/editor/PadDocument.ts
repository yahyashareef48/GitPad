import * as vscode from 'vscode';

import {
  parseDocument,
  serializeDocument,
  writeField,
} from '../../core/markdown/frontmatter';
import type { Clock } from '../../core/ports/Clock';
import type { FileSystem } from '../../core/ports/FileSystem';
import type { Logger } from '../../core/ports/Logger';

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

  /** Stamps `updated` on save. Optional so tests can omit it. */
  public clock: Clock | undefined;

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
    current: string,
    saved: string,
  ) {
    this.currentText = current;
    this.savedText = saved;
  }

  public static async create(
    uri: vscode.Uri,
    backupId: string | undefined,
    fs: FileSystem,
    logger: Logger,
  ): Promise<PadDocument> {
    const onDisk = await readText(fs, uri.fsPath).catch((error: unknown) => {
      // Opening empty beats refusing to open. A note that cannot be read at
      // all is still better presented as a blank editor the user can act on
      // than as a modal they can only dismiss.
      logger.warn(`Could not read ${uri.fsPath}; opening empty`, error);

      return '';
    });

    if (backupId === undefined) {
      return new PadDocument(uri, fs, onDisk, onDisk);
    }

    /*
     * `backupId` is a URI STRING, not a filesystem path.
     *
     * It is whatever backupCustomDocument returned as its id, which is
     * `destination.toString()` -- e.g. `file:///c%3A/Users/...`. Handing that
     * to a path-based API produces nonsense like `C:\file:\c%3A\Users\...`
     * and the note becomes unopenable.
     */
    const backupPath = vscode.Uri.parse(backupId).fsPath;
    const restored = await readText(fs, backupPath).catch((error: unknown) => {
      logger.warn(`Backup ${backupPath} could not be read; using the file on disk`, error);

      return undefined;
    });

    /*
     * A stale backup must never block opening the note.
     *
     * VS Code can hand back an id for a backup that has since been cleaned up
     * or removed. Falling back to the file on disk loses nothing that still
     * exists, whereas throwing here makes the note permanently unopenable
     * until the user finds and clears VS Code's storage by hand.
     */
    if (restored === undefined) {
      return new PadDocument(uri, fs, onDisk, onDisk);
    }

    // Restored content differs from what is on disk, so the document opens
    // dirty -- otherwise the recovered work could be discarded without a
    // prompt.
    return new PadDocument(uri, fs, restored, onDisk);
  }

  public get text(): string {
    return this.currentText;
  }

  /**
   * The document without its frontmatter -- what the editor shows.
   *
   * Frontmatter must never reach the editor. `---` followed by text is a
   * setext heading in markdown, so a metadata block renders as a giant title
   * made of `created:` and `updated:`. Worse, once the editor owns it, a round
   * trip through the editor's own serializer can reformat or lose keys that
   * belong to the user or to another tool.
   */
  public get body(): string {
    return parseDocument(this.currentText).body;
  }

  /**
   * Records an edit to the body, preserving frontmatter exactly.
   *
   * The editor only ever sends body text, so the metadata is reattached here
   * byte-for-byte rather than passing through anything that might rewrite it.
   */
  public editBody(body: string, label = 'Edit'): void {
    const { frontmatter } = parseDocument(this.currentText);

    this.edit(serializeDocument({ frontmatter, body }), label);
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
    /*
     * `updated` is stamped here rather than on every edit.
     *
     * Stamping per keystroke would rewrite frontmatter constantly and, once
     * sync exists, put a metadata change in every commit. Save is the moment
     * the file actually changes, so it is the honest moment to record.
     */
    if (this.clock !== undefined) {
      const parsed = parseDocument(this.currentText);

      // Only touched when there is already a frontmatter block; a note without
      // one should not grow metadata just by being saved.
      if (parsed.frontmatter.length > 0) {
        this.currentText = serializeDocument({
          ...parsed,
          frontmatter: writeField(parsed.frontmatter, 'updated', this.clock.nowIso()),
        });
      }
    }

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

  /**
   * Reloads from disk after the file changed underneath us.
   *
   * Returns what happened, so the caller can decide whether to tell the user.
   * A dirty document is never overwritten silently -- that is someone's
   * unsaved work, and losing it to a background sync would be unforgivable.
   */
  public async reloadFromDisk(): Promise<'unchanged' | 'reloaded' | 'conflict'> {
    const onDisk = await readText(this.fs, this.uri.fsPath).catch(() => undefined);

    if (onDisk === undefined || onDisk === this.currentText) {
      // Also the self-write case: our own save fires the watcher, and the
      // content matching is exactly how we recognise it.
      this.savedText = onDisk ?? this.savedText;

      return 'unchanged';
    }

    if (this.isDirty) {
      return 'conflict';
    }

    this.savedText = onDisk;
    this.replace(onDisk);

    return 'reloaded';
  }

  /** Accepts the version on disk, discarding local changes. */
  public async acceptDiskVersion(): Promise<void> {
    await this.revert();
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
