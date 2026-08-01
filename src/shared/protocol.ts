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
  /** No vault configured yet -- the sidebar shows the welcome screen. */
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
  | { readonly type: 'openDocument'; readonly id: string };

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
  | { readonly type: 'tree'; readonly nodes: readonly TreeNodeDto[] };
