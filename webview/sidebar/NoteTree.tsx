import { Tree, type NodeRendererProps } from 'react-arborist';
import { useEffect, useRef, useState } from 'react';

import type { TreeNodeDto } from '../../src/shared/protocol';

/*
 * The notes tree.
 *
 * react-arborist supplies what a native VS Code TreeView would have given us
 * for free once the sidebar became a webview: virtualisation, keyboard
 * navigation and drag-and-drop. See plan 2.2 for why that trade was made.
 */

interface NoteTreeProps {
  readonly nodes: readonly TreeNodeDto[];
  readonly onOpen: (id: string) => void;
}

export function NoteTree({ nodes, onOpen }: NoteTreeProps) {
  const size = useElementSize();

  if (nodes.length === 0) {
    return (
      <div className="placeholder">
        <p>No notes yet.</p>
      </div>
    );
  }

  return (
    <div className="tree" ref={size.ref}>
      <Tree<TreeNodeDto>
        data={nodes as TreeNodeDto[]}
        // react-arborist virtualises, so it needs explicit pixel dimensions
        // rather than being able to fill its parent with CSS.
        width={size.width}
        height={size.height}
        rowHeight={22}
        indent={12}
        disableEdit
        disableDrag
        disableDrop
        onActivate={(node) => {
          if (!node.data.children) {
            onOpen(node.data.id);
          }
        }}
      >
        {Row}
      </Tree>
    </div>
  );
}

function Row({ node, style, dragHandle }: NodeRendererProps<TreeNodeDto>) {
  const isFolder = node.data.kind === 'folder';

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`row${node.isSelected ? ' row--selected' : ''}`}
      onClick={() => {
        if (isFolder) {
          node.toggle();
        } else {
          node.activate();
        }
      }}
    >
      <span className="row__twisty">{isFolder ? (node.isOpen ? '⌄' : '›') : ''}</span>
      <span className="row__name">{node.data.name}</span>
    </div>
  );
}

/**
 * Reports the element's pixel size, kept current as the sidebar is resized.
 *
 * Needed because react-arborist virtualises rows and therefore cannot be sized
 * by CSS alone -- without this the tree renders at a fixed guess and clips.
 */
function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return { ref, ...size };
}
