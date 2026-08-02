import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import type { HostToSettings, SettingsToHost } from '../../src/shared/protocol';
import { createBridge } from '../shared/rpc';
import { SettingsPage } from './SettingsPage';
import './styles.css';

/*
 * Settings webview entry point.
 *
 * The bridge is created once here rather than inside a component, because
 * acquireVsCodeApi() throws if called twice and StrictMode mounts twice.
 */

const bridge = createBridge<SettingsToHost, HostToSettings>();
const container = document.getElementById('root');

if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <SettingsPage bridge={bridge} />
    </StrictMode>,
  );
}
