import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { EditorToHost, HostToEditor } from '../../src/shared/protocol';
import { createBridge } from '../shared/rpc';
import { Editor } from './Editor';
/*
 * Crepe's structural CSS, imported piece by piece.
 *
 * Two things are deliberately absent:
 *
 *  - Its shipped colour themes (frame, nord, classic). crepe-theme.css
 *    supplies those variables from VS Code instead.
 *  - `common/style.css`, the barrel that imports every feature's stylesheet
 *    including latex.css -- which pulls in KaTeX and roughly forty font files
 *    for a feature we have switched off. Importing the parts we use keeps them
 *    out of the bundle entirely.
 *
 * Adding a Crepe feature means adding its stylesheet here too, or it renders
 * unstyled.
 */
import '@milkdown/crepe/theme/common/prosemirror.css';
import '@milkdown/crepe/theme/common/reset.css';
import '@milkdown/crepe/theme/common/block-edit.css';
import '@milkdown/crepe/theme/common/code-mirror.css';
import '@milkdown/crepe/theme/common/cursor.css';
import '@milkdown/crepe/theme/common/image-block.css';
import '@milkdown/crepe/theme/common/link-tooltip.css';
import '@milkdown/crepe/theme/common/list-item.css';
import '@milkdown/crepe/theme/common/placeholder.css';
import '@milkdown/crepe/theme/common/toolbar.css';
import '@milkdown/crepe/theme/common/table.css';
import './crepe-theme.css';
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
