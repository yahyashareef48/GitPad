/*
 * Turning a note title into a filename, safely.
 *
 * In GitPad the title IS the filename (plan section 2.6) -- there is no `title`
 * in frontmatter and no `# Heading` duplicating it, so nothing can drift out of
 * sync. The cost is that every title has to survive being a real path segment
 * on the most restrictive filesystem we support, which is Windows.
 */

/** Shown for a note whose title has never been set. */
export const UNTITLED = 'Untitled';

/**
 * Long enough never to bother a human, short enough to stay clear of path
 * limits once a deep folder chain and the extension are added.
 */
const MAX_STEM_LENGTH = 200;

/** Illegal in Windows path segments; `/` is illegal everywhere. */
const ILLEGAL_CHARACTERS = /[\\/:*?"<>|]/g;

/**
 * Windows refuses these names with or without an extension, so `CON.pad` fails
 * just as `CON` does. Inherited from DOS device names and still enforced.
 */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * Removes C0 controls and DEL, turning tab / newline / carriage return into
 * spaces on the way. Those three separate words, so dropping them outright
 * would silently glue "line one" and "line two" into "line oneline two".
 *
 * Written as a code-point filter rather than a regex literal because a range
 * like /[\x00-\x1F]/ is easy to corrupt when a file is generated or rewritten
 * by tooling, and the corruption is invisible in most editors.
 */
function stripControlCharacters(value: string): string {
  let result = '';

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      result += ' ';
    } else if (code >= 0x20 && code !== 0x7f) {
      result += character;
    }
  }

  return result;
}

/**
 * Converts a title into a filename stem (no extension).
 *
 * Always returns something usable: a title that sanitises away to nothing
 * becomes `Untitled` rather than an empty filename.
 */
export function titleToStem(title: string): string {
  let stem = stripControlCharacters(title)
    // Illegal characters become spaces rather than being deleted, so
    // "Q1: results" reads as "Q1 results" instead of losing the word break.
    .replace(ILLEGAL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (stem.length > MAX_STEM_LENGTH) {
    stem = stem.slice(0, MAX_STEM_LENGTH).trim();
  }

  // Windows silently strips trailing dots and spaces, which would make the
  // name on disk differ from the title the user typed.
  stem = stem.replace(/[. ]+$/, '');

  if (stem.length === 0) {
    return UNTITLED;
  }

  if (RESERVED_NAMES.has(stem.toLowerCase())) {
    return `${stem}_`;
  }

  return stem;
}

/**
 * Returns `stem` if free, otherwise `stem 2`, `stem 3`, … until one is.
 *
 * `taken` holds the stems already used in the target folder. Comparison is
 * case-insensitive because Windows and macOS filesystems are: treating `Notes`
 * and `notes` as distinct would produce a name that collides on write.
 */
export function uniquifyStem(stem: string, taken: Iterable<string>): string {
  const used = new Set<string>();

  for (const name of taken) {
    used.add(name.toLowerCase());
  }

  if (!used.has(stem.toLowerCase())) {
    return stem;
  }

  // Starts at 2: the unsuffixed name is conceptually the first.
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem} ${suffix}`;

    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

/** Convenience for the "new note" path: a safe, unused, untitled stem. */
export function nextUntitledStem(taken: Iterable<string>): string {
  return uniquifyStem(UNTITLED, taken);
}
