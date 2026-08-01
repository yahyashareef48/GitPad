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

/**
 * A typed channel for one webview surface.
 *
 * `acquireVsCodeApi()` may only be called once per webview, so this must be
 * called exactly once per surface and the result shared.
 */
export function createBridge<Outgoing, Incoming>() {
  const api = acquireVsCodeApi();

  return {
    post(message: Outgoing): void {
      api.postMessage(message);
    },

    onMessage(handler: (message: Incoming) => void): void {
      window.addEventListener('message', (event: MessageEvent) => {
        handler(event.data as Incoming);
      });
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
