import { useEffect, useState } from 'react';

import type { HostToSidebar, SidebarToHost, VaultState } from '../../src/shared/protocol';
import type { Bridge } from '../shared/rpc';
import { WelcomeView } from './WelcomeView';

/*
 * Sidebar root. Renders whatever the host says the current state is.
 *
 * The webview holds no authoritative state of its own -- the extension host
 * owns the vault and the filesystem, and pushes state down. Anything cached
 * here would eventually disagree with the disk.
 */

interface AppProps {
  readonly bridge: Bridge<SidebarToHost, HostToSidebar>;
}

export function App({ bridge }: AppProps) {
  // `undefined` means the host has not answered yet, which is distinct from
  // "no vault" -- showing the welcome screen during that gap would make the
  // buttons flash on every reload for users who already have a vault.
  const [vault, setVault] = useState<VaultState | undefined>(undefined);

  useEffect(() => {
    bridge.onMessage((message) => {
      switch (message.type) {
        case 'vaultState':
          setVault(message.state);
          break;
      }
    });

    bridge.post({ type: 'ready' });
  }, [bridge]);

  if (vault === undefined) {
    return null;
  }

  if (vault.kind === 'no-vault') {
    return (
      <WelcomeView
        onCreate={() => bridge.post({ type: 'createVault' })}
        onOpen={() => bridge.post({ type: 'openVault' })}
      />
    );
  }

  return (
    <div className="placeholder">
      <p>Vault open. The notes tree lands next.</p>
      <p className="placeholder__path">{vault.root}</p>
    </div>
  );
}
