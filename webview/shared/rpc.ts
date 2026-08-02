/*
 * Webview half of the RPC bridge.
 *
 * The extension-host half lives in src/ui/; the message shapes both sides
 * agree on live in src/shared/protocol.ts. This file only exists to wrap
 * VS Code's untyped webview API in something type-safe.
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export interface Bridge<Outgoing, Incoming> {
  post(message: Outgoing): void;
  onMessage(handler: (message: Incoming) => void): () => void;
  getState(): unknown;
  setState(state: unknown): void;
}

/**
 * A typed channel for one webview surface.
 *
 * `acquireVsCodeApi()` may only be called once per webview, so this must be
 * called exactly once per surface and the result shared.
 */
export function createBridge<Outgoing, Incoming>(): Bridge<Outgoing, Incoming> {
  const api = acquireVsCodeApi();

  return {
    post(message: Outgoing): void {
      api.postMessage(message);
    },

    /** Returns an unsubscribe function, so React effects can clean up. */
    onMessage(handler: (message: Incoming) => void): () => void {
      const listener = (event: MessageEvent) => {
        handler(event.data as Incoming);
      };

      window.addEventListener('message', listener);

      return () => {
        window.removeEventListener('message', listener);
      };
    },

    /**
     * Sidebar webviews are destroyed when hidden and rebuilt when revealed,
     * so anything that should survive that (scroll position, expanded
     * folders, search text) has to live here rather than in memory.
     */
    getState(): unknown {
      return api.getState();
    },

    setState(state: unknown): void {
      api.setState(state);
    },
  };
}
