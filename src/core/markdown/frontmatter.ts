/*
 * Minimal YAML frontmatter handling -- deliberately narrow.
 *
 * GitPad stores only two fields today (`created`, `updated`), both ISO 8601
 * strings, so this reads and writes a flat block of `key: value` lines and
 * nothing else. It is NOT a YAML parser and must not grow into one.
 *
 * M3 replaces this with the real remark pipeline (remark-frontmatter +
 * gray-matter), which is where nested values, quoting rules and edge cases
 * belong. Until then the contract is: anything this does not understand is
 * preserved byte-for-byte rather than reformatted, so a note written by
 * Obsidian or edited by hand does not lose metadata by passing through GitPad.
 */

const DELIMITER = '---';

/** U+FEFF. Compared by code point: a literal BOM in source is invisible. */
const BYTE_ORDER_MARK = 0xfeff;

export interface ParsedDocument {
  /** Raw frontmatter lines, without the delimiters. Empty when there is none. */
  readonly frontmatter: readonly string[];
  readonly body: string;
}

export function parseDocument(raw: string): ParsedDocument {
  const normalized = raw.charCodeAt(0) === BYTE_ORDER_MARK ? raw.slice(1) : raw;

  if (!normalized.startsWith(`${DELIMITER}\n`) && !normalized.startsWith(`${DELIMITER}\r\n`)) {
    return { frontmatter: [], body: normalized };
  }

  const lines = normalized.split(/\r?\n/);
  const closing = lines.indexOf(DELIMITER, 1);

  // An unterminated block is content, not metadata. Treating it as frontmatter
  // would swallow the whole note.
  if (closing === -1) {
    return { frontmatter: [], body: normalized };
  }

  return {
    frontmatter: lines.slice(1, closing),
    body: lines.slice(closing + 1).join('\n'),
  };
}

/** Reads one scalar field. Returns undefined when absent or empty. */
export function readField(frontmatter: readonly string[], key: string): string | undefined {
  const prefix = `${key}:`;

  for (const line of frontmatter) {
    if (line.startsWith(prefix)) {
      const value = line.slice(prefix.length).trim();

      return value === '' ? undefined : stripQuotes(value);
    }
  }

  return undefined;
}

/**
 * Sets a field, preserving every other line exactly as it was.
 *
 * Rewriting the block wholesale would drop keys GitPad does not know about --
 * tags, aliases, anything a user or another tool put there.
 */
export function writeField(
  frontmatter: readonly string[],
  key: string,
  value: string,
): readonly string[] {
  const prefix = `${key}:`;
  const replaced = frontmatter.map((line) => (line.startsWith(prefix) ? `${key}: ${value}` : line));

  return replaced.some((line) => line.startsWith(prefix))
    ? replaced
    : [...replaced, `${key}: ${value}`];
}

export function serializeDocument(document: ParsedDocument): string {
  if (document.frontmatter.length === 0) {
    return document.body;
  }

  return [DELIMITER, ...document.frontmatter, DELIMITER, document.body].join('\n');
}

function stripQuotes(value: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(value);

  return quoted?.[2] ?? value;
}
