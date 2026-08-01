import { useEffect, useMemo, useState } from 'react';

import { filterTree } from '../../src/shared/filterTree';
import type {
  HostToSidebar,
  RecentItemDto,
  SidebarToHost,
  TreeNodeDto,
  VaultState,
} from '../../src/shared/protocol';
import type { Bridge } from '../shared/rpc';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { NoteTree } from './NoteTree';
import { RecentlyOpenedList } from './RecentlyOpenedList';
import { SearchBox } from './SearchBox';
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
  // Purely a view concern: the user asked to switch vaults but has not yet
  // picked one. The host knows nothing about it, and cancelling costs nothing.
  const [choosing, setChoosing] = useState(false);
  const [menu, setMenu] = useState<{ node: TreeNodeDto; x: number; y: number } | undefined>(
    undefined,
  );
  const [recent, setRecent] = useState<readonly RecentItemDto[]>([]);
  const [query, setQuery] = useState('');

  /*
   * Filtered locally rather than by asking the host.
   *
   * The webview already holds the whole tree, so matching here is instant and
   * survives a slow or busy extension host. Memoised because the tree is
   * rebuilt on every keystroke otherwise.
   */
  const visible = useMemo(() => filterTree(nodes, query), [nodes, query]);

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      switch (message.type) {
        case 'vaultState':
          setVault(message.state);

          // A vault opened, so the switch is over. Cancelling the OS dialog
          // sends nothing, which correctly leaves the chooser on screen.
          if (message.state.kind === 'ready') {
            setChoosing(false);
          }
          break;

        case 'tree':
          setNodes(message.nodes);
          break;

        case 'recentlyOpened':
          setRecent(message.items);
          break;
      }
    });

    bridge.post({ type: 'ready' });

    return unsubscribe;
  }, [bridge]);

  // `undefined` is "the host has not replied"; `loading` is "the host replied,
  // and it is still checking for a saved vault". Both must avoid the welcome
  // screen, or someone who already has a vault gets asked to pick one again.
  if (vault === undefined || vault.kind === 'loading') {
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

  // Switching vaults: same screen as first run, plus a way back. Going
  // straight to the OS folder dialog from "Change" leaves no exit if it was a
  // misclick, and no explanation of what is about to happen.
  if (choosing) {
    return (
      <WelcomeView
        onCreate={() => bridge.post({ type: 'createVault' })}
        onOpen={() => bridge.post({ type: 'openVault' })}
        onCancel={() => setChoosing(false)}
      />
    );
  }

  const menuItems = (node: TreeNodeDto): readonly MenuItem[] => [
    ...(node.kind === 'folder'
      ? [
          {
            label: 'New note here',
            onSelect: () => bridge.post({ type: 'createNote', parentId: node.id }),
          },
          {
            label: 'New folder here',
            onSelect: () => bridge.post({ type: 'createFolder', parentId: node.id }),
          },
        ]
      : []),
    {
      label: 'Rename',
      onSelect: () => bridge.post({ type: 'renameItem', id: node.id, currentName: node.name }),
      separated: node.kind === 'folder',
    },
    ...(node.kind === 'document'
      ? [{ label: 'Duplicate', onSelect: () => bridge.post({ type: 'duplicateItem', id: node.id }) }]
      : []),
    {
      label: 'Delete',
      onSelect: () => bridge.post({ type: 'trashItem', id: node.id, name: node.name }),
      separated: true,
    },
  ];

  return (
    <div className="shell">
      <VaultHeader
        root={vault.root}
        onChange={() => setChoosing(true)}
        onNewNote={() => bridge.post({ type: 'createNote' })}
        onNewFolder={() => bridge.post({ type: 'createFolder' })}
        onSettings={() => bridge.post({ type: 'openSettings' })}
      />

      <SearchBox value={query} onChange={setQuery} />

      {/* Hidden while filtering: the point of a filter is to narrow what is on
          screen, and a recents list that ignores the query fights that. */}
      {query === '' ? (
        <RecentlyOpenedList
          items={recent}
          onOpen={(id) => bridge.post({ type: 'openDocument', id })}
        />
      ) : null}

      <div className="shell__body">
        <NoteTree
          nodes={visible}
          emptyMessage={query === '' ? 'No notes yet.' : `Nothing matches “${query}”.`}
          onOpen={(id) => bridge.post({ type: 'openDocument', id })}
          onContextMenu={(node, x, y) => setMenu({ node, x, y })}
        />
      </div>

      {menu === undefined ? null : (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.node)}
          onClose={() => setMenu(undefined)}
        />
      )}
    </div>
  );
}
