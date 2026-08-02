import type { Clock } from '../core/ports/Clock';

/** The real clock. Tests substitute a fixed one. */
export class SystemClock implements Clock {
  public now(): number {
    return Date.now();
  }

  public nowIso(): string {
    // toISOString() is always UTC and always the same shape -- both of which
    // matter for values that end up in synced frontmatter.
    return new Date().toISOString();
  }
}
