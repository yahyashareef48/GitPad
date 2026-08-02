import { useState } from 'react';

import type { RecentItemDto } from '../../src/shared/protocol';
import { PadIcon } from '../shared/PadIcon';
import { Icon } from './Icon';

/*
 * The notes you were last working in.
 *
 * Collapsible and remembers its own state, because this is the kind of section
 * people either rely on constantly or want out of the way entirely.
 */

interface RecentlyOpenedListProps {
  readonly items: readonly RecentItemDto[];
  readonly onOpen: (id: string) => void;
}

export function RecentlyOpenedList({ items, onOpen }: RecentlyOpenedListProps) {
  const [open, setOpen] = useState(true);

  // Hidden entirely when empty rather than shown as an empty heading: a
  // brand-new vault should not display a section that explains nothing.
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
        <span className="section__title">Recently opened</span>
      </button>

      {open
        ? items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="row row--flat"
              title={item.id}
              onClick={() => onOpen(item.id)}
            >
              <span className="row__icon">
                <PadIcon size={14} />
              </span>
              <span className="row__name">{item.name}</span>
            </button>
          ))
        : null}
    </section>
  );
}
