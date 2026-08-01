import { useEffect, useRef, useState } from 'react';

import type { NoteMetaDto } from '../../src/shared/protocol';

/*
 * The note's title and timestamps, above the editing surface.
 *
 * The title is editable in place, Notion-style. Because the title IS the
 * filename (plan 2.6), committing an edit here renames the file -- so it is
 * committed on blur or Enter rather than per keystroke, which would otherwise
 * rename the file once per character typed.
 */

interface NoteHeaderProps {
  readonly meta: NoteMetaDto;
  readonly onRename: (title: string) => void;
}

export function NoteHeader({ meta, onRename }: NoteHeaderProps) {
  const [draft, setDraft] = useState(meta.title);
  const committed = useRef(meta.title);

  /*
   * Follows the host when the title changes underneath us -- a rename from
   * the sidebar, or the host resolving a typed title to a different name
   * because it collided or contained characters a filename cannot hold.
   */
  useEffect(() => {
    setDraft(meta.title);
    committed.current = meta.title;
  }, [meta.title]);

  const commit = () => {
    const next = draft.trim();

    // An empty title would produce a nameless file; restoring the previous one
    // is friendlier than rejecting the edit with an error.
    if (next === '' || next === committed.current) {
      setDraft(committed.current);
      return;
    }

    committed.current = next;
    onRename(next);
  };

  return (
    <header className="note-header">
      <div className="note-header__row">
        <span className="note-header__icon codicon codicon-file" aria-hidden />

        <input
          className="note-header__title"
          value={draft}
          spellCheck={false}
          aria-label="Note title"
          placeholder="Untitled"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }

            if (event.key === 'Escape') {
              setDraft(committed.current);
              event.currentTarget.blur();
            }
          }}
        />
      </div>

      {meta.created === undefined && meta.updated === undefined ? null : (
        <p className="note-header__meta">
          {meta.created === undefined ? null : <span>Created {formatStamp(meta.created)}</span>}
          {meta.created !== undefined && meta.updated !== undefined ? (
            <span className="note-header__dot">·</span>
          ) : null}
          {meta.updated === undefined ? null : <span>Updated {formatStamp(meta.updated)}</span>}
        </p>
      )}
    </header>
  );
}

/**
 * Formats an ISO timestamp in the reader's locale.
 *
 * Stored as UTC so a vault synced across timezones does not reorder itself,
 * but displayed local -- a note written at 9am should say 9am.
 */
function formatStamp(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    // Hand-edited or written by another tool; showing it raw beats "Invalid Date".
    return iso;
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
