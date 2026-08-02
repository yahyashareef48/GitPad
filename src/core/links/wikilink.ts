/*
 * `[[Wikilink]]` parsing.
 *
 * Pure text handling, deliberately separate from the index that uses it, so
 * the fiddly part -- what counts as a link and what does not -- is testable on
 * its own.
 *
 * The syntax is Obsidian's, because it is the one most people already know and
 * because a vault should stay usable in other tools:
 *
 *   [[Note title]]            link, displayed as the title
 *   [[Note title|shown text]] link, displayed as something else
 */

export interface Wikilink {
  /** The note being linked to, as written. */
  readonly target: string;
  /** What to display. Falls back to the target. */
  readonly label: string;
}

/**
 * Matches `[[target]]` and `[[target|label]]`.
 *
 * Neither part may contain `]` or a newline, so an unclosed bracket cannot
 * swallow the rest of the document.
 */
const WIKILINK = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

/** Fenced code blocks, then inline code spans. */
const FENCED_CODE = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`\n]*`/g;

/**
 * Extracts every wikilink from a note body, in document order.
 *
 * Links inside code are ignored: a note explaining the syntax, or containing
 * code that happens to use double brackets, must not generate phantom links to
 * notes that do not exist.
 */
export function extractWikilinks(markdown: string): readonly Wikilink[] {
  const withoutCode = markdown.replace(FENCED_CODE, '').replace(INLINE_CODE, '');
  const links: Wikilink[] = [];

  for (const match of withoutCode.matchAll(WIKILINK)) {
    const target = match[1]?.trim();

    if (target === undefined || target === '') {
      continue;
    }

    const label = match[2]?.trim();

    links.push({ target, label: label === undefined || label === '' ? target : label });
  }

  return links;
}

/**
 * The key a target resolves by.
 *
 * Case- and whitespace-insensitive, because a link typed as `[[my note]]`
 * should find `My Note.pad`. Filenames are case-insensitive on Windows and
 * macOS anyway, so treating them otherwise would resolve differently depending
 * on which machine a vault was opened on.
 */
export function linkKey(target: string): string {
  return target.trim().toLowerCase();
}
