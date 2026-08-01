import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/*
 * A right-click menu.
 *
 * Hand-built because VS Code's menu contributions do not reach inside a
 * webview -- one of the things given up by making the sidebar a webview
 * instead of a native TreeView (plan 2.2).
 */

export interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  /** Draws a divider above this item. */
  readonly separated?: boolean;
}

interface ContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  /*
   * Nudged back inside the viewport after measuring.
   *
   * A sidebar is narrow and short, so a menu opened near the bottom or right
   * edge would otherwise be clipped -- and a webview cannot overflow its own
   * iframe the way a native menu can escape its window.
   */
  useLayoutEffect(() => {
    const element = ref.current;

    if (element === null) {
      return;
    }

    const box = element.getBoundingClientRect();

    setPosition({
      left: Math.max(0, Math.min(x, window.innerWidth - box.width)),
      top: Math.max(0, Math.min(y, window.innerHeight - box.height)),
    });
  }, [x, y]);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node) !== true) {
        onClose();
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // `capture` so a click is caught before it reaches the tree underneath and
    // selects a different row on the way out.
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);

    return () => {
      document.removeEventListener('mousedown', dismiss, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div className="menu" ref={ref} style={position} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`menu__item${item.separated === true ? ' menu__item--separated' : ''}`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
