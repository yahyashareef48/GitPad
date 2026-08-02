/*
 * Features that are built but not switched on.
 *
 * A flag rather than deleted code: the implementation, its tests and the
 * reasoning behind it all stay in the repository, and turning it back on is
 * one line instead of an archaeology exercise. Deleting working code because
 * it is not finished is how the same problem gets solved twice.
 */

/**
 * `[[Wikilinks]]` — the index, backlinks panel, clickable chips, `[[`
 * autocomplete and link rewriting on rename.
 *
 * All of it works. It is off because the edge cases around a note's identity
 * are not settled: what a link means when two notes share a title, when the
 * note it points at is deleted, when a folder is renamed rather than a note,
 * and how much of that a user should have to think about. Shipping a linking
 * feature that is right most of the time is worse than not shipping one --
 * a link you cannot trust is one you stop using.
 *
 * Re-enable by setting this to `true`; nothing else is required. Tracked in
 * docs/PROGRESS.md under M4.
 */
export const WIKILINKS_ENABLED = false;
