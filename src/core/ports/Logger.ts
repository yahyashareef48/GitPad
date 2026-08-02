/*
 * Logging, as the domain sees it.
 *
 * Backed by a VS Code output channel in production (platform/), and by a
 * silent or collecting implementation in tests.
 */

export interface Logger {
  debug(message: string, ...details: readonly unknown[]): void;
  info(message: string, ...details: readonly unknown[]): void;
  warn(message: string, ...details: readonly unknown[]): void;

  /**
   * `error` takes the caught value rather than a pre-formatted string so the
   * implementation can decide how much of a stack trace to surface.
   */
  error(message: string, error?: unknown): void;
}
