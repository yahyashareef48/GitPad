import type { HostToSidebar, SidebarToHost } from '../../src/shared/protocol';
import { createBridge } from '../shared/rpc';

/*
 * Sidebar webview entry point. Runs in a browser sandbox, not Node.
 *
 * Intentionally trivial for now: it proves the full path works end to end --
 * bundle is built, served under the CSP, executed in the iframe, and can talk
 * to the extension host in both directions. The real tree replaces this in M1.
 */

const bridge = createBridge<SidebarToHost, HostToSidebar>();
const root = document.getElementById('root');

bridge.onMessage((message) => {
  switch (message.type) {
    case 'init':
      if (root) {
        root.textContent = message.text;
      }
      break;
  }
});

// The host waits for this before sending anything -- see SidebarViewProvider.
bridge.post({ type: 'ready' });
