/*
 * Pinned markdown serializer options.
 *
 * Without these, remark-stringify picks its own defaults and rewrites
 * constructs it did not author: `---` becomes `***`, bullets flip character,
 * emphasis switches marker. Nothing is lost, but opening and saving a note
 * produces a diff of changes the user did not make -- and once sync exists, a
 * commit of them. Plan 2.3 asks for exactly this.
 *
 * Applied through Milkdown's `remarkStringifyOptionsCtx`, which is passed
 * straight to `unified().use(remarkStringify, options)`.
 *
 * Lives in shared/ because the editor webview and the round-trip corpus must
 * use identical settings; a corpus testing different options from the editor
 * would be worse than no corpus.
 */
export const REMARK_STRINGIFY_OPTIONS = {
  /** `---` for thematic breaks, matching what almost everyone types. */
  rule: '-',
  ruleRepetition: 3,
  /** `*` bullets, consistent with what Crepe's own UI inserts. */
  bullet: '*',
  /** Keeps `_italic_` from appearing where the user typed `*italic*`. */
  emphasis: '*',
  strong: '*',
  /** Backtick fences rather than indented code, which is ambiguous in lists. */
  fence: '`',
  fences: true,
  /** One space of list indent -- four re-reads as a code block in some parsers. */
  listItemIndent: 'one',
} as const;
