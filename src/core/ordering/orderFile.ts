/*
 * `.gitpad-order` -- the per-folder manual ordering file.
 *
 * Two design rules, both load-bearing:
 *
 * 1. It is ADVISORY. It records a preference, never the truth about what exists.
 *    A file created, deleted or moved outside GitPad -- through the OS file
 *    manager, or by git during a merge -- cannot corrupt the view, because
 *    anything unlisted falls back to alphabetical and anything listed but
 *    missing is ignored. The tree self-heals.
 *
 * 2. Ordering lives here rather than in each note's frontmatter, because
 *    dragging one note would otherwise rewrite every note in the folder --
 *    twenty modified files in a diff for one gesture.
 *
 * It doubles as the marker that keeps an empty folder alive across a sync,
 * since git tracks files and not directories.
 */

const HEADER = `# GitPad folder order — safe to edit or delete.
# Names not listed here fall back to alphabetical; names that no longer
# exist are ignored.
`;

/** Reads the ordering, ignoring comments, blanks and surrounding whitespace. */
export function parseOrderFile(raw: string): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const name = line.trim();

    if (name === '' || name.startsWith('#')) {
      continue;
    }

    // A duplicated name would otherwise place the same entry twice.
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

export function serializeOrderFile(names: readonly string[]): string {
  return `${HEADER}${names.join('\n')}\n`;
}

/**
 * Applies a recorded order to whatever actually exists.
 *
 * Listed entries come first, in listed order. Everything else follows in
 * alphabetical order, so a newly created file appears in a predictable place
 * rather than wherever the filesystem happened to return it.
 */
export function applyOrder<T>(
  entries: readonly T[],
  order: readonly string[],
  keyOf: (entry: T) => string,
): readonly T[] {
  const remaining = new Map<string, T[]>();

  for (const entry of entries) {
    const key = keyOf(entry);
    const bucket = remaining.get(key);

    if (bucket === undefined) {
      remaining.set(key, [entry]);
    } else {
      // Two entries can share a display name (`notes.pad` and a `notes`
      // folder), so buckets rather than a plain Map value.
      bucket.push(entry);
    }
  }

  const ordered: T[] = [];

  for (const name of order) {
    const bucket = remaining.get(name);

    if (bucket !== undefined) {
      ordered.push(...bucket);
      remaining.delete(name);
    }
  }

  const rest = [...remaining.values()].flat();
  rest.sort((left, right) => keyOf(left).localeCompare(keyOf(right)));

  return [...ordered, ...rest];
}
