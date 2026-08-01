import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { HostToSidebar, SidebarToHost } from '../../src/shared/protocol';
import { createBridge } from '../shared/rpc';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';

/*
 * Sidebar webview entry point. Runs in a browser sandbox, not Node.
 *
 * The bridge is created once here rather than inside a component, because
 * acquireVsCodeApi() throws if called twice and React may mount more than once
 * (StrictMode does exactly that in development).
 */

const bridge = createBridge<SidebarToHost, HostToSidebar>();
const container = document.getElementById('root');

if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App bridge={bridge} />
      </ErrorBoundary>
    </StrictMode>,
  );
}
