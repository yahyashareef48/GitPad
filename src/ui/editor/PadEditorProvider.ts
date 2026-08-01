import * as vscode from 'vscode';

import type { Clock } from '../../core/ports/Clock';
import type { FileSystem } from '../../core/ports/FileSystem';
import type { Logger } from '../../core/ports/Logger';
import type { EditorTextSize, EditorToHost, HostToEditor } from '../../shared/protocol';
import { renderWebviewHtml } from '../webview/WebviewHost';
import type { AutoSave } from './AutoSave';
import { PadDocument } from './PadDocument';

/*
 * GitPad's editor for `.pad` files.
 *
 * Registered as the default editor for the extension, which is safe precisely
 * because `.pad` is ours: a default-priority editor for `.md` would hijack
 * every markdown file in every project the user opens (plan 1.4).
 *
 * The editing surface is Milkdown's Crepe. The webview is sent, and returns,
 * BODY text only -- frontmatter is held here and reattached on the way out, so
 * metadata can never be reformatted or lost by a round trip through the
 * editor's serializer.
 */
export class PadEditorProvider implements vscode.CustomEditorProvider<PadDocument> {
  public static readonly viewType = 'gitpad.editor';

  /** Webviews currently showing each document, keyed by document URI. */
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();

  /** One filesystem watcher per open document, disposed with it. */
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();

  private readonly documentChanged = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<PadDocument>
  >();
  public readonly onDidChangeCustomDocument = this.documentChanged.event;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly fs: FileSystem,
    private readonly autoSave: AutoSave,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<PadDocument> {
    const document = await PadDocument.create(uri, context.backupId, this.fs, this.logger);

    document.clock = this.clock;

    // Forwarded rather than exposed directly: VS Code subscribes to the
    // provider, not to individual documents.
    document.onDidChangeDocument((event) => {
      this.documentChanged.fire(event);
    });

    // Content can change without the webview knowing -- undo, redo, revert,
    // or the file changing on disk. Every panel showing it needs telling.
    document.onDidChangeContent(() => {
      // Body only: frontmatter never reaches the editor (see PadDocument.body).
      this.broadcast(document, { type: 'setText', text: document.body });
    });

    this.watch(document);

    return document;
  }

  /**
   * Keeps an open note in step with the file on disk.
   *
   * Matters most once sync exists: git pulling another device's edits changes
   * the file underneath an open editor, and without this the user would keep
   * editing a stale copy and overwrite the incoming change on next save.
   */
  private watch(document: PadDocument): void {
    const watcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);

    const onChanged = () => {
      void this.reload(document);
    };

    watcher.onDidChange(onChanged);
    // Some tools replace a file rather than writing in place, which arrives as
    // delete-then-create rather than a change.
    watcher.onDidCreate(onChanged);

    this.watchers.set(document.uri.toString(), watcher);
  }

  private async reload(document: PadDocument): Promise<void> {
    const outcome = await document.reloadFromDisk();

    if (outcome === 'reloaded') {
      this.logger.info(`Reloaded ${document.uri.fsPath} after an external change`);
      return;
    }

    if (outcome !== 'conflict') {
      return;
    }

    /*
     * The file changed while the user has unsaved edits.
     *
     * Never resolved automatically. Auto-save makes this rare, and when it
     * does happen both versions are someone's work -- picking one silently is
     * exactly the behaviour the merge invariant forbids elsewhere.
     */
    const keepMine = 'Keep my version';
    const useTheirs = 'Use the version on disk';

    const choice = await vscode.window.showWarningMessage(
      `“${document.uri.path.split('/').pop() ?? ''}” changed on disk while you were editing it.`,
      { modal: true, detail: 'Your unsaved changes and the file on disk have both moved on.' },
      keepMine,
      useTheirs,
    );

    if (choice === useTheirs) {
      await document.acceptDiskVersion();
    }

    // Keeping the local version needs no action: the document is still dirty,
    // and the next save writes over what is on disk.
  }

  public async resolveCustomEditor(
    document: PadDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    this.track(document, panel);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };

    panel.webview.html = renderWebviewHtml({
      webview: panel.webview,
      extensionUri: this.extensionUri,
      entry: 'editor',
      title: 'GitPad',
    });

    panel.webview.onDidReceiveMessage((message: EditorToHost) => {
      switch (message.type) {
        case 'ready':
          // Only after the webview says it is listening: messages posted to a
          // still-loading webview are dropped silently.
          void panel.webview.postMessage({
            type: 'init',
            text: document.body,
            editable: true,
            textSize: readTextSize(),
          } satisfies HostToEditor);
          break;

        case 'edit':
          document.editBody(message.text);
          this.autoSave.schedule(document.uri);
          break;
      }
    });

    /*
     * A pending save is flushed when the note stops being visible, rather than
     * waiting out the debounce. Closing a tab mid-debounce would otherwise
     * either lose the last few seconds of typing or raise a save prompt for
     * changes GitPad was about to write anyway.
     */
    panel.onDidChangeViewState(() => {
      if (!panel.visible) {
        void this.autoSave.flush(document.uri);
      }
    });

    panel.onDidDispose(() => {
      void this.autoSave.flush(document.uri);
    });

    // Settings must take effect immediately; requiring a reload to see the
    // result of changing one reads as the setting not working.
    const settingsListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitpad.editor.textSize')) {
        void panel.webview.postMessage({
          type: 'settings',
          textSize: readTextSize(),
        } satisfies HostToEditor);
      }
    });

    panel.onDidDispose(() => {
      settingsListener.dispose();
    });
  }

  public saveCustomDocument(
    document: PadDocument,
    cancellation: vscode.CancellationToken,
  ): Thenable<void> {
    // A manual Ctrl+S makes any queued auto-save redundant; leaving it armed
    // would write the same content again a moment later.
    this.autoSave.cancel(document.uri);

    return document.save(cancellation);
  }

  public saveCustomDocumentAs(
    document: PadDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Thenable<void> {
    return document.saveAs(destination, cancellation);
  }

  public revertCustomDocument(document: PadDocument): Thenable<void> {
    return document.revert();
  }

  public backupCustomDocument(
    document: PadDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken,
  ): Thenable<vscode.CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }

  public dispose(): void {
    this.documentChanged.dispose();

    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }

    this.watchers.clear();
  }

  private track(document: PadDocument, panel: vscode.WebviewPanel): void {
    const key = document.uri.toString();
    const existing = this.panels.get(key) ?? new Set<vscode.WebviewPanel>();

    existing.add(panel);
    this.panels.set(key, existing);

    panel.onDidDispose(() => {
      existing.delete(panel);

      if (existing.size === 0) {
        this.panels.delete(key);

        // Last view of this note closed, so stop watching its file.
        this.watchers.get(key)?.dispose();
        this.watchers.delete(key);
      }
    });
  }

  /**
   * Sends to every panel showing this document.
   *
   * The same note can be open in a split view; undoing in one must update the
   * other, or the two views disagree about a file that has only one state.
   */
  private broadcast(document: PadDocument, message: HostToEditor): void {
    const panels = this.panels.get(document.uri.toString());

    if (panels === undefined) {
      this.logger.debug(`No panel for ${document.uri.fsPath}; dropped ${message.type}`);
      return;
    }

    for (const panel of panels) {
      void panel.webview.postMessage(message);
    }
  }
}

function readTextSize(): EditorTextSize {
  return vscode.workspace
    .getConfiguration()
    .get<EditorTextSize>('gitpad.editor.textSize', 'medium');
}
