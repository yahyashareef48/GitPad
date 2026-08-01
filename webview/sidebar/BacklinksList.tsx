import { useState } from 'react';

import type { RecentItemDto } from '../../src/shared/protocol';
import { PadIcon } from '../shared/PadIcon';
import { Icon } from './Icon';

/*
 * Notes that link to the one currently open.
 *
 * The half of wikilinks people actually rely on: writing a link is deliberate,
 * but discovering what already points at a note is how connections you had
 * forgotten resurface.
 */

interface BacklinksListProps {
  readonly items: readonly RecentItemDto[];
  readonly onOpen: (id: string) => void;
}

export function BacklinksList({ items, onOpen }: BacklinksListProps) {
  const [open, setOpen] = useState(true);

  // Hidden when empty rather than shown as a heading over nothing -- most
  // notes have no backlinks, and a permanent empty section is just noise.
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
        <span className="section__title">Linked from ({items.length})</span>
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
