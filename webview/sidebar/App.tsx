import { useEffect, useState } from 'react';

import type {
  HostToSidebar,
  SidebarToHost,
  TreeNodeDto,
  VaultState,
} from '../../src/shared/protocol';
import type { Bridge } from '../shared/rpc';
import { NoteTree } from './NoteTree';
import { VaultHeader } from './VaultHeader';
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
  const [nodes, setNodes] = useState<readonly TreeNodeDto[]>([]);

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      switch (message.type) {
        case 'vaultState':
          setVault(message.state);
          break;

        case 'tree':
          setNodes(message.nodes);
          break;
      }
    });

    bridge.post({ type: 'ready' });

    return unsubscribe;
  }, [bridge]);

  if (vault === undefined) {
    return <div className="placeholder">Loading…</div>;
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
    <div className="shell">
      <VaultHeader root={vault.root} onChange={() => bridge.post({ type: 'openVault' })} />

      <div className="shell__body">
        <NoteTree nodes={nodes} onOpen={(id) => bridge.post({ type: 'openDocument', id })} />
      </div>
    </div>
  );
}
