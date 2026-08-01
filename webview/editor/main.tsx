import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { EditorToHost, HostToEditor } from '../../src/shared/protocol';
import { createBridge } from '../shared/rpc';
import { Editor } from './Editor';
import './styles.css';

/*
 * Editor webview entry point. Runs in a browser sandbox, not Node.
 *
 * The bridge is created once here rather than inside a component, because
 * acquireVsCodeApi() throws if called twice and React may mount more than once
 * (StrictMode does exactly that in development).
 */

const bridge = createBridge<EditorToHost, HostToEditor>();
const container = document.getElementById('root');

if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <Editor bridge={bridge} />
    </StrictMode>,
  );
}
