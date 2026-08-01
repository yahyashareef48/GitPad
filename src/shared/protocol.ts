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

/** Messages the sidebar webview sends to the extension host. */
export type SidebarToHost = {
  /**
   * Sent once the webview script has executed and is ready to render.
   * The host must not post state before receiving this: a webview that is
   * still loading silently drops messages.
   */
  readonly type: 'ready';
};

/** Messages the extension host sends to the sidebar webview. */
export type HostToSidebar = {
  /** First payload after `ready`. Placeholder until the tree lands in M1. */
  readonly type: 'init';
  readonly text: string;
};
