import * as vscode from 'vscode';

import type { Clock } from '../../core/ports/Clock';
import { groupByTitle, resolveIn } from '../../core/links/LinkIndex';
import type { LinkRenamer } from '../../core/links/LinkRenamer';
import type { NoteService } from '../../core/vault/NoteService';
import { NOTE_EXTENSION } from '../../core/vault/VaultLayout';
import { VaultTree } from '../../core/vault/VaultTree';
import type { FileSystem } from '../../core/ports/FileSystem';
import type { Logger } from '../../core/ports/Logger';
import * as path from 'node:path';

import { parseDocument, readField } from '../../core/markdown/frontmatter';
import type {
  EditorTextSize,
  EditorToHost,
  HostToEditor,
  LinkTargetDto,
  NoteMetaDto,
} from '../../shared/protocol';
import type { VaultController } from '../vault/VaultController';
import { findLinkingNotes, offerLinkUpdate } from '../vault/updateLinksOnRename';
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
    private readonly notes: NoteService,
    private readonly vault: VaultController,
    private readonly renamer: LinkRenamer,
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

    /*
     * GitPad's mark in the tab, rather than the generic file icon.
     *
     * An extension cannot inject an icon into whatever file icon theme the
     * user has chosen, but a custom editor CAN set its own tab icon -- which
     * is the only way to make a `.pad` tab recognisable at a glance.
     */
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'pad-file.svg');

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
            meta: readMeta(document),
          } satisfies HostToEditor);

          // Titles for `[[` autocomplete. Sent after init so the editor can
          // render before the vault scan finishes.
          void this.postNoteTitles(panel, document.uri.fsPath);
          break;

        case 'edit':
          document.editBody(message.text);
          this.autoSave.schedule(document.uri);
          break;

        case 'rename':
          void this.rename(document, panel, message.title);
          break;

        case 'openWikilink':
          void this.openWikilink(message.target, document.uri.fsPath);
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

    /*
     * Titles are refreshed when the vault changes, not only on open.
     * Otherwise a note created after this editor opened would be missing
     * from its autocomplete until the tab was reopened.
     */
    const vaultListener = this.vault.onDidChangeContents(() => {
      void this.postNoteTitles(panel, document.uri.fsPath);
    });

    panel.onDidDispose(() => {
      settingsListener.dispose();
      vaultListener.dispose();
    });
  }

  /**
   * Renames the note by renaming its file, then reopens it.
   *
   * A custom editor is bound to a URI, so the file cannot be renamed
   * underneath it -- the open document would point at a path that no longer
   * exists. Reopening at the new URI and closing the old tab is the only
   * honest way to do this, and it is why the rename is committed on blur
   * rather than per keystroke.
   */
  private async rename(
    document: PadDocument,
    panel: vscode.WebviewPanel,
    title: string,
  ): Promise<void> {
    const layout = this.vault.currentLayout;

    if (layout === undefined) {
      return;
    }

    try {
      // Unsaved work first: the rename moves the file, and anything still
      // queued would be written to a path that no longer exists.
      await this.autoSave.flush(document.uri);

      // Captured BEFORE the rename, for the same reason as in the sidebar.
      const affected = await findLinkingNotes(this.renamer, layout.root, document.uri.fsPath);
      const renamed = await this.notes.rename(layout, document.uri.fsPath, title);

      if (renamed === document.uri.fsPath) {
        // Sanitising or uniquifying landed on the current name. Nothing moved,
        // but the header may be showing what the user typed rather than what
        // the file is called.
        void panel.webview.postMessage({
          type: 'meta',
          meta: readMeta(document),
        } satisfies HostToEditor);

        return;
      }

      const column = panel.viewColumn;

      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(renamed),
        PadEditorProvider.viewType,
        column,
      );

      panel.dispose();

      await offerLinkUpdate(this.renamer, affected, document.uri.fsPath, renamed);
    } catch (error) {
      this.logger.error(`Could not rename ${document.uri.fsPath}`, error);

      vscode.window.showErrorMessage(
        error instanceof Error ? error.message : 'Could not rename the note.',
      );
    }
  }

  /**
   * Follows a `[[wikilink]]`, offering to create the note if it is missing.
   *
   * Resolution matches the index: by filename stem, case-insensitively, so a
   * link keeps working when the note is moved or its title recased.
   */
  private async openWikilink(target: string, source: string): Promise<void> {
    const layout = this.vault.currentLayout;

    if (layout === undefined) {
      return;
    }

    const tree = new VaultTree(this.fs, this.logger, new Set([NOTE_EXTENSION]));
    const files = collectPaths(await tree.build(layout.root));

    // Resolved through the SAME function the index uses, and from the point
    // of view of the note the link is IN, so a duplicate title resolves to
    // the nearest one -- and to the same note the sidebar reported.
    const match = resolveIn(groupByTitle(files), target, source);

    if (match !== undefined) {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(match),
        PadEditorProvider.viewType,
      );

      return;
    }

    /*
     * Offer to create it rather than reporting an error.
     *
     * Linking to a note before writing it is a normal way to work, so the
     * useful response to a missing target is to make it exist.
     */
    const create = 'Create note';

    const choice = await vscode.window.showInformationMessage(
      `No note called “${target}”.`,
      create,
    );

    if (choice !== create) {
      return;
    }

    try {
      const created = await this.notes.createNote(layout, layout.root);
      const renamed = await this.notes.rename(layout, created, target);

      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(renamed),
        PadEditorProvider.viewType,
      );
    } catch (error) {
      this.logger.error(`Could not create a note for ${target}`, error);
    }
  }

  /**
   * Sends every note title in the vault, for `[[` autocomplete.
   *
   * Titles rather than paths: a wikilink resolves by title, so offering a
   * path would let the user pick something the syntax cannot express.
   */
  private async postNoteTitles(panel: vscode.WebviewPanel, exclude: string): Promise<void> {
    const layout = this.vault.currentLayout;

    if (layout === undefined) {
      return;
    }

    try {
      const tree = new VaultTree(this.fs, this.logger, new Set([NOTE_EXTENSION]));
      const titles = buildLinkTargets(
        collectPaths(await tree.build(layout.root)),
        layout.root,
        exclude,
      );

      // Logged at info because "autocomplete shows nothing" is answerable
      // from here: either the scan found no titles, or it found them and the
      // fault is in the webview.
      this.logger.info(`Sent ${titles.length} note titles for autocomplete`);

      void panel.webview.postMessage({ type: 'noteTitles', titles } satisfies HostToEditor);
    } catch (error) {
      // Autocomplete is a convenience; failing to populate it must not stop
      // the note opening.
      this.logger.warn('Could not list note titles for autocomplete', error);
    }
  }

  public saveCustomDocument(
    document: PadDocument,
    cancellation: vscode.CancellationToken,
  ): Thenable<void> {
    // A manual Ctrl+S makes any queued auto-save redundant; leaving it armed
    // would write the same content again a moment later.
    this.autoSave.cancel(document.uri);

    return document.save(cancellation).then(() => {
      // The save just stamped `updated`, so the header would otherwise show
      // a timestamp one save behind.
      this.broadcast(document, { type: 'meta', meta: readMeta(document) });
    });
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

/** Title comes from the filename; timestamps come from frontmatter. */
function readMeta(document: PadDocument): NoteMetaDto {
  const { frontmatter } = parseDocument(document.text);
  const stem = path.parse(document.uri.fsPath).name;

  return {
    title: stem,
    created: readField(frontmatter, 'created'),
    updated: readField(frontmatter, 'updated'),
  };
}

/** Every document path in the tree, depth-first. */
function collectPaths(
  nodes: readonly { id: string; children?: readonly unknown[] }[],
): readonly string[] {
  const paths: string[] = [];

  const walk = (list: readonly { id: string; children?: readonly unknown[] }[]): void => {
    for (const node of list) {
      if (node.children === undefined) {
        paths.push(node.id);
      } else {
        walk(node.children as readonly { id: string; children?: readonly unknown[] }[]);
      }
    }
  };

  walk(nodes);

  return paths;
}

/**
 * Builds the autocomplete list.
 *
 * The note being edited is excluded -- offering to link a note to itself is
 * never what someone means, and it wastes the top of a short list.
 *
 * A folder is attached only where a title is ambiguous, and the inserted
 * text is path-qualified in exactly those cases, so picking a row opens that
 * row rather than whichever same-named note happens to be nearest.
 */
function buildLinkTargets(
  files: readonly string[],
  root: string,
  exclude: string,
): readonly LinkTargetDto[] {
  const others = files.filter((file) => file !== exclude);
  const counts = new Map<string, number>();

  for (const file of others) {
    const key = path.parse(file).name.toLowerCase();

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return others.map((file) => {
    const title = path.parse(file).name;
    const ambiguous = (counts.get(title.toLowerCase()) ?? 0) > 1;

    if (!ambiguous) {
      return { title, insert: title };
    }

    const relative = path.relative(root, path.dirname(file));
    // An empty relative path means the vault root, which has no name of
    // its own -- shown as "/" so the row is not blank.
    const folder = relative === "" ? "/" : relative.split(path.sep).join("/");

    return {
      title,
      folder,
      insert: relative === "" ? title : `${folder}/${title}`,
    };
  });
}
