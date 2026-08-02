import { useState } from 'react';

import type { TrashItemDto } from '../../src/shared/protocol';
import { PadIcon } from '../shared/PadIcon';
import { Icon } from './Icon';

/*
 * What is in the bin.
 *
 * Deleting a note is reversible, but only if you can find it -- and until this
 * existed, recovering one meant knowing that `.trash/` was a folder and going
 * looking for it in the file manager. Nobody does that at the moment they need
 * to.
 */

interface TrashListProps {
  readonly items: readonly TrashItemDto[];
  readonly onRestore: (id: string) => void;
  readonly onPurge: (id: string, name: string) => void;
  readonly onEmpty: () => void;
}

export function TrashList({ items, onRestore, onPurge, onEmpty }: TrashListProps) {
  // Collapsed by default: this is somewhere you go when something has gone
  // wrong, not somewhere you want occupying the sidebar every day.
  const [open, setOpen] = useState(false);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="section">
      <button
        type="button"
        className="section__header"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        <span className="section__title">Trash ({items.length})</span>

        {open ? (
          <span
            className="section__action"
            role="button"
            tabIndex={0}
            title="Delete everything in the trash permanently"
            onClick={(event) => {
              // Otherwise the click also toggles the section shut.
              event.stopPropagation();
              onEmpty();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.stopPropagation();
                onEmpty();
              }
            }}
          >
            Empty
          </span>
        ) : null}
      </button>

      {open
        ? items.map((item) => (
            <div key={item.id} className="row row--flat trash-row" title={formatDeleted(item)}>
              <span className="row__icon">
                {/* A deleted folder is one entry containing everything that
                    was inside it, so it must not look like a note. */}
                {item.kind === 'folder' ? <Icon name="folder" /> : <PadIcon size={14} />}
              </span>
              <span className="row__name">{item.name}</span>

              {/* Where it goes back to, so restoring is never a surprise. */}
              {item.originalFolder === '' ? null : (
                <span className="trash-row__folder">{item.originalFolder}</span>
              )}

              <button
                type="button"
                className="icon-button trash-row__action"
                title="Restore to the vault"
                onClick={() => onRestore(item.id)}
              >
                <Icon name="discard" />
              </button>

              <button
                type="button"
                className="icon-button trash-row__action"
                title="Delete permanently"
                onClick={() => onPurge(item.id, item.name)}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))
        : null}
    </section>
  );
}

function formatDeleted(item: TrashItemDto): string {
  if (item.deletedAt === undefined) {
    return item.name;
  }

  const date = new Date(item.deletedAt);

  return Number.isNaN(date.getTime())
    ? item.name
    : `Deleted ${date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}
