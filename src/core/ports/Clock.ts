/*
 * Time, as the domain sees it.
 *
 * This exists so `created` / `updated` frontmatter is testable. Domain code
 * that calls `Date.now()` directly cannot be asserted against without either
 * mocking globals or writing tests that accept any value -- both of which make
 * the tests weaker than the code they cover.
 */

export interface Clock {
  /** Milliseconds since epoch. */
  now(): number;

  /**
   * ISO 8601 in UTC -- the exact form written to frontmatter.
   *
   * UTC, not local time: a vault synced between machines in different
   * timezones must not reorder itself depending on which device wrote last.
   */
  nowIso(): string;
}
