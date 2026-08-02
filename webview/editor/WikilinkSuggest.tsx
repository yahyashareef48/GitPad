import { useEffect, useMemo, useState } from 'react';

import { PadIcon } from '../shared/PadIcon';
import type { LinkTargetDto } from '../../src/shared/protocol';
import type { SuggestState } from './suggestPlugin';

/*
 * The popup shown while typing `[[`.
 *
 * Filters the vault's note titles as you type. Purely presentational -- when
 * to appear and what the query is are decided by the ProseMirror plugin, which
 * is the only thing that sees every transaction.
 */

const MAX_RESULTS = 8;

interface WikilinkSuggestProps {
  readonly state: SuggestState;
  readonly titles: readonly LinkTargetDto[];
  readonly selected: number;
  readonly onSelect: (target: LinkTargetDto) => void;
  readonly onHighlight: (index: number) => void;
}

/** Titles matching the query, best-first. */
export function useMatches(
  titles: readonly LinkTargetDto[],
  query: string,
): readonly LinkTargetDto[] {
  return useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (needle === '') {
      return titles.slice(0, MAX_RESULTS);
    }

    return (
      titles
        .filter((entry) => entry.title.toLowerCase().includes(needle))
        /*
         * Titles that START with the query come first.
         *
         * Typing "st" for "Standup" should not be buried under "Test standup"
         * just because both contain it.
         */
        .sort((left, right) => {
          const leftStarts = left.title.toLowerCase().startsWith(needle);
          const rightStarts = right.title.toLowerCase().startsWith(needle);

          if (leftStarts !== rightStarts) {
            return leftStarts ? -1 : 1;
          }

          return left.title.localeCompare(right.title);
        })
        .slice(0, MAX_RESULTS)
    );
  }, [titles, query]);
}

export function WikilinkSuggest({
  state,
  titles,
  selected,
  onSelect,
  onHighlight,
}: WikilinkSuggestProps) {
  const matches = useMatches(titles, state.query);
  const [position, setPosition] = useState({ left: state.coords.left, top: state.coords.bottom });

  /*
   * Nudged back inside the viewport.
   *
   * A link typed near the right or bottom edge would otherwise open a popup
   * that is partly off-screen, and a webview cannot overflow its own iframe.
   */
  useEffect(() => {
    const width = 240;
    const height = Math.min(matches.length, MAX_RESULTS) * 24 + 8;

    setPosition({
      left: Math.max(4, Math.min(state.coords.left, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(state.coords.bottom + 4, window.innerHeight - height - 4)),
    });
  }, [state.coords.left, state.coords.bottom, matches.length]);

  if (matches.length === 0) {
    return (
      <div className="suggest" style={position} role="listbox">
        <div className="suggest__empty">
          No note called “{state.query}”. Keep typing to create it.
        </div>
      </div>
    );
  }

  return (
    <div className="suggest" style={position} role="listbox">
      {matches.map((entry, index) => (
        <button
          key={entry.insert}
          type="button"
          role="option"
          aria-selected={index === selected}
          className={`suggest__item${index === selected ? ' suggest__item--selected' : ''}`}
          // Mouse down rather than click: clicking would blur the editor first,
          // which closes the popup before the selection is read.
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(entry);
          }}
          onMouseEnter={() => onHighlight(index)}
        >
          <PadIcon size={13} />
          <span className="suggest__title">{entry.title}</span>
          {/* Only present when another note shares this title. */}
          {entry.folder === undefined ? null : (
            <span className="suggest__folder">{entry.folder}</span>
          )}
        </button>
      ))}
    </div>
  );
}
