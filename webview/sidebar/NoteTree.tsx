import { Tree, type NodeRendererProps } from 'react-arborist';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
  readonly onContextMenu: (node: TreeNodeDto, x: number, y: number) => void;
}

export function NoteTree({ nodes, onOpen, onContextMenu }: NoteTreeProps) {
  const size = useElementSize();

  /*
   * The measured container is ALWAYS rendered, and the empty state lives
   * inside it rather than replacing it.
   *
   * Returning early for the empty case unmounts the ref'd element, so the
   * measuring effects -- which run once, on mount -- find a null ref and never
   * attach an observer. When notes later arrive the element mounts, but the
   * effects do not re-run, so the tree stays at 0x0 and a virtualised tree at
   * zero height draws nothing at all. The panel then looks empty forever, with
   * no error and no clue.
   */
  return (
    <div className="tree" ref={size.ref}>
      {nodes.length === 0 ? (
        <div className="placeholder">No notes yet.</div>
      ) : (
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
          {(props) => <Row {...props} onContextMenu={onContextMenu} />}
        </Tree>
      )}
    </div>
  );
}

function Row({
  node,
  style,
  dragHandle,
  onContextMenu,
}: NodeRendererProps<TreeNodeDto> & {
  readonly onContextMenu: (node: TreeNodeDto, x: number, y: number) => void;
}) {
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
      onContextMenu={(event) => {
        event.preventDefault();
        // Selected first, so the menu visibly applies to the row it opened on.
        node.select();
        onContextMenu(node.data, event.clientX, event.clientY);
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

  /*
   * Measured synchronously before paint, not only from the ResizeObserver.
   *
   * The observer fires asynchronously, so relying on it alone means the first
   * render is 0x0 -- and a virtualised tree at zero height draws nothing. If
   * the observer then never fires (which it will not when the element's box
   * does not subsequently change) the panel simply stays empty, with no error.
   */
  useLayoutEffect(() => {
    const element = ref.current;

    if (element !== null) {
      const box = element.getBoundingClientRect();

      setSize({ width: box.width, height: box.height });
    }
  }, []);

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
