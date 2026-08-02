/*
 * Rewriting `[[wikilinks]]` when the note they point at is renamed.
 *
 * The alternative -- giving every note a stable id and linking by that -- was
 * rejected deliberately. An id in the link text (`[[id:a3f9c2]]`) means the
 * file no longer says what it means, stops working in Obsidian, and introduces
 * a SECOND identifier alongside the filename. The filename is already the
 * single source of truth (plan 2.6); the job is to keep links in step with it.
 *
 * Pure text in, pure text out, so the fiddly part is testable on its own.
 */

/** Fenced code blocks, then inline code spans. */
const FENCED_CODE = /^```[\s\S]*?^```/gm;
const INLINE_CODE = /`[^`\n]*`/g;

const WIKILINK = /\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g;

/**
 * Replaces links pointing at `oldTitle` so they point at `newTitle`.
 *
 * Handles the three forms a link can take:
 *   [[Old]]            -> [[New]]
 *   [[Old|shown]]      -> [[New|shown]]     display text is the author's
 *   [[Work/Old]]       -> [[Work/New]]      path qualification is preserved
 *
 * Links inside code are left alone, matching the index and the editor: a note
 * explaining the syntax must not be edited by a rename.
 */
export function rewriteLinks(text: string, oldTitle: string, newTitle: string): string {
  const wanted = oldTitle.trim().toLowerCase();

  if (wanted === '') {
    return text;
  }

  /*
   * Code regions are located first and their spans skipped, rather than
   * stripped as the index does. The index only reads; this returns the
   * document, so the code has to still be there afterwards.
   */
  const protectedSpans = findSpans(text, [FENCED_CODE, INLINE_CODE]);

  return text.replace(WIKILINK, (match, target: string, label: string | undefined, offset: number) => {
    if (protectedSpans.some(([start, end]) => offset >= start && offset < end)) {
      return match;
    }

    const segments = target.split('/');
    const stem = segments[segments.length - 1] ?? '';

    if (stem.trim().toLowerCase() !== wanted) {
      return match;
    }

    // The folder prefix is kept exactly: a link written as `Work/Old` was
    // qualified for a reason, and the note is still in that folder.
    segments[segments.length - 1] = matchLeadingSpace(stem, newTitle);

    return `[[${segments.join('/')}${label ?? ''}]]`;
  });
}

/** Byte ranges matched by any of `patterns`. */
function findSpans(text: string, patterns: readonly RegExp[]): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];

  for (const pattern of patterns) {
    // Cloned so the shared lastIndex of a global regex cannot leak between
    // calls and silently skip matches.
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      if (match.index !== undefined) {
        spans.push([match.index, match.index + match[0].length]);
      }
    }
  }

  return spans;
}

/**
 * Preserves whatever padding the author wrote around the title.
 *
 * `[[ Old ]]` should become `[[ New ]]` rather than being tidied, because a
 * rename is not the moment to reformat someone's document.
 */
function matchLeadingSpace(original: string, replacement: string): string {
  const leading = /^\s*/.exec(original)?.[0] ?? '';
  const trailing = /\s*$/.exec(original)?.[0] ?? '';

  return `${leading}${replacement}${trailing}`;
}
