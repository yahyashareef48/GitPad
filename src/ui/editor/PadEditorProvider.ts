import * as vscode from 'vscode';

import type { FileSystem } from '../../core/ports/FileSystem';
import type { Logger } from '../../core/ports/Logger';
import type { EditorToHost, HostToEditor } from '../../shared/protocol';
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
 * The editor surface is a plain textarea for now, on purpose. M2 exists to
 * prove this API works -- document lifecycle, dirty state, save, and the undo
 * bridge -- before a rich editor is layered on in M3. If undo misbehaves with
 * a textarea, the fault is here; if it only misbehaves after Milkdown arrives,
 * the fault is there. One suspect at a time.
 */
export class PadEditorProvider implements vscode.CustomEditorProvider<PadDocument> {
  public static readonly viewType = 'gitpad.editor';

  /** Webviews currently showing each document, keyed by document URI. */
  private readonly panels = new Map<string, Set<vscode.WebviewPanel>>();

  private readonly documentChanged = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<PadDocument>
  >();
  public readonly onDidChangeCustomDocument = this.documentChanged.event;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly fs: FileSystem,
    private readonly autoSave: AutoSave,
    private readonly logger: Logger,
  ) {}

  public async openCustomDocument(
    uri: vscode.Uri,
    context: vscode.CustomDocumentOpenContext,
  ): Promise<PadDocument> {
    const document = await PadDocument.create(uri, context.backupId, this.fs);

    // Forwarded rather than exposed directly: VS Code subscribes to the
    // provider, not to individual documents.
    document.onDidChangeDocument((event) => {
      this.documentChanged.fire(event);
    });

    // Content can change without the webview knowing -- undo, redo, revert,
    // or the file changing on disk. Every panel showing it needs telling.
    document.onDidChangeContent((text) => {
      this.broadcast(document, { type: 'setText', text });
    });

    return document;
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
            text: document.text,
            editable: true,
          } satisfies HostToEditor);
          break;

        case 'edit':
          document.edit(message.text);
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
