/*
 * The one module imported by BOTH the extension host and the webviews.
 *
 * Everything else is strictly one side or the other (see src/ and webview/).
 * Keeping the wire format in a single shared file means a message the host
 * sends and a message the webview expects cannot drift apart without a
 * typecheck failure.
 *
 * Rules:
 *  - every message is a member of a discriminated union, keyed on `type`
 *  - no `any` ever crosses this boundary
 *  - this file imports nothing, so neither environment can leak into the other
 */

/**
 * One entry in the sidebar tree.
 *
 * Mirrors core/vault/VaultTree's node, restated here because this file must
 * import nothing -- both environments need it, and neither may reach into the
 * other's modules.
 */
export interface TreeNodeDto {
  /** Absolute path. Stable and unique, so it doubles as the React key. */
  readonly id: string;
  readonly name: string;
  readonly kind: 'folder' | 'document';
  /** Present on folders only; absent on documents. */
  readonly children?: readonly TreeNodeDto[];
}

/** What the sidebar should be showing. */
export type VaultState =
  /**
   * Startup has not finished checking for a saved vault.
   *
   * Distinct from `no-vault` on purpose. Reopening a saved vault means async
   * disk work, and the sidebar asks for state the moment it is revealed --
   * which on a reload is immediately. Reporting `no-vault` during that window
   * shows the welcome screen to someone who already has a vault, and if they
   * act on it they are asked to pick one all over again.
   */
  | { readonly kind: 'loading' }
  /** No vault configured -- the sidebar shows the welcome screen. */
  | { readonly kind: 'no-vault' }
  /** A vault is open. Tree contents arrive in a separate `tree` message. */
  | { readonly kind: 'ready'; readonly root: string };

/** Messages the sidebar webview sends to the extension host. */
export type SidebarToHost =
  /**
   * Sent once the webview script has executed and is ready to render.
   * The host must not post state before receiving this: a webview that is
   * still loading silently drops messages.
   */
  | { readonly type: 'ready' }
  /** Welcome screen: pick a folder and set up a new vault in it. */
  | { readonly type: 'createVault' }
  /** Welcome screen: pick a folder that already holds notes. */
  | { readonly type: 'openVault' }
  /** Open a document in an editor tab. */
  | { readonly type: 'openDocument'; readonly id: string }
  /**
   * Create in `parentId`, or at the vault root when omitted.
   *
   * The host resolves the name: titles are sanitised for the filesystem and
   * uniquified against siblings, so the webview cannot know it in advance.
   */
  | { readonly type: 'createNote'; readonly parentId?: string }
  | { readonly type: 'createFolder'; readonly parentId?: string }
  | { readonly type: 'renameItem'; readonly id: string; readonly currentName: string }
  | { readonly type: 'duplicateItem'; readonly id: string }
  | { readonly type: 'trashItem'; readonly id: string; readonly name: string }
  /**
   * Opens GitPad's settings.
   *
   * Currently VS Code's own settings UI filtered to this extension. The
   * dedicated settings page (plan 5.4) replaces this in M4.
   */
  | { readonly type: 'openSettings' }
  | { readonly type: 'restoreItem'; readonly id: string }
  | { readonly type: 'purgeItem'; readonly id: string; readonly name: string }
  | { readonly type: 'emptyTrash' }
  /**
   * Drag-and-drop result.
   *
   * `parentId` is the destination folder, or undefined for the vault root.
   * `index` is the position within that folder's visible order.
   */
  | {
      readonly type: 'moveItem';
      readonly id: string;
      readonly parentId?: string;
      readonly index: number;
    };

/** Messages the extension host sends to the sidebar webview. */
export type HostToSidebar =
  | { readonly type: 'vaultState'; readonly state: VaultState }
  /**
   * The complete tree, re-sent whenever anything changes.
   *
   * Whole-tree replacement rather than incremental patches: a notes vault is
   * small, and the filesystem -- not the webview -- is the source of truth. A
   * patch stream would introduce a second copy that can drift from the disk.
   */
  | { readonly type: 'tree'; readonly nodes: readonly TreeNodeDto[] }
  /**
   * Most-recently-opened documents, newest first.
   *
   * Device-local and never synced: "recent on this machine" is not a fact
   * about the vault, and seeing your laptop's history on your desktop would
   * be noise rather than continuity.
   */
  | { readonly type: 'recentlyOpened'; readonly items: readonly RecentItemDto[] }
  /**
   * Notes linking to whatever note is currently open.
   *
   * Sent on every active-editor change, including an empty list, so the panel
   * cannot show one note's backlinks while another is open.
   */
  | { readonly type: 'backlinks'; readonly items: readonly RecentItemDto[] }
  /** Contents of `.trash/`, newest deletion first. */
  | { readonly type: 'trash'; readonly items: readonly TrashItemDto[] };

export interface TrashItemDto {
  readonly id: string;
  readonly name: string;
  /** ISO 8601. Absent for files not deleted by GitPad. */
  readonly deletedAt?: string;
}

export interface RecentItemDto {
  readonly id: string;
  readonly name: string;
}

/* ---------------------------------------------------------------------------
 * Editor channel
 *
 * A second, independent channel (see 1.5). The editor webview knows nothing
 * about the sidebar and vice versa; they share only this module.
 * ------------------------------------------------------------------------ */

export type EditorTextSize = 'small' | 'medium' | 'large';

/** One note offered by `[[` autocomplete. */
export interface LinkTargetDto {
  readonly title: string;
  /**
   * Folder shown beside the title, and ONLY when another note shares that
   * title. A folder on every row is noise; a folder on the ambiguous ones is
   * the difference between picking correctly and guessing.
   */
  readonly folder?: string;
  /**
   * What to write inside `[[ ]]`.
   *
   * Path-qualified when the title is ambiguous. Inserting the bare title
   * there would resolve by proximity and could open a different note from
   * the one picked from the list.
   */
  readonly insert: string;
}

/** Note identity and timestamps, shown in the editor's title header. */
export interface NoteMetaDto {
  /** The filename stem -- the title IS the filename (plan 2.6). */
  readonly title: string;
  /** ISO 8601, from frontmatter. Absent on notes that have none. */
  readonly created?: string;
  readonly updated?: string;
}

/** Messages the editor webview sends to the extension host. */
export type EditorToHost =
  /** The webview has executed and can render. Nothing is posted before this. */
  | { readonly type: 'ready' }
  /**
   * The user changed the document.
   *
   * Carries the whole text rather than a patch. Notes are small, and a patch
   * protocol would need its own conflict handling between the webview's view
   * of the document and the host's -- complexity that buys nothing at this
   * size. The rich editor in M3 may revisit this.
   */
  | { readonly type: 'edit'; readonly text: string }
  /**
   * The user edited the title header.
   *
   * The title is the filename, so this renames the file. The host resolves the
   * final name -- it is sanitised for the filesystem and uniquified against
   * siblings, so it may differ from what was typed.
   */
  | { readonly type: 'rename'; readonly title: string }
  /**
   * Follow a `[[wikilink]]`.
   *
   * Carries the target as written; the host resolves it, because resolution
   * needs the vault and the webview has no view of it.
   */
  | { readonly type: 'openWikilink'; readonly target: string };

/** Messages the extension host sends to the editor webview. */
export type HostToEditor =
  | {
      readonly type: 'init';
      readonly text: string;
      readonly editable: boolean;
      readonly textSize: EditorTextSize;
      readonly meta: NoteMetaDto;
    }
  /** Sent when settings change, so the editor updates without a reload. */
  | { readonly type: 'settings'; readonly textSize: EditorTextSize }
  /** Sent after a save or rename, so the header's timestamps stay current. */
  | { readonly type: 'meta'; readonly meta: NoteMetaDto }
  /** Notes offered by `[[` autocomplete. */
  | { readonly type: 'noteTitles'; readonly titles: readonly LinkTargetDto[] }
  /**
   * Replace the editor's content wholesale.
   *
   * Sent for undo, redo, revert, and external file changes -- every case where
   * the new text did NOT originate in this webview. The webview must apply it
   * without echoing an `edit` back, or undo would immediately re-record itself
   * as a fresh change.
   */
  | { readonly type: 'setText'; readonly text: string };

/* ---------------------------------------------------------------------------
 * Settings channel
 * ------------------------------------------------------------------------ */

/** What the settings page shows about the vault itself. */
export interface VaultSummaryDto {
  readonly root: string;
  readonly noteCount: number;
  readonly trashCount: number;
  /** Bytes on disk, notes only. */
  readonly sizeBytes: number;
}

export type SettingsToHost =
  | { readonly type: 'ready' }
  | { readonly type: 'set'; readonly key: string; readonly value: string | number | boolean }
  | { readonly type: 'action'; readonly action: string };

export type HostToSettings = {
  readonly type: 'state';
  /** Current value of every editable setting, keyed by configuration key. */
  readonly values: Readonly<Record<string, string | number | boolean>>;
  readonly vault: VaultSummaryDto | undefined;
};
