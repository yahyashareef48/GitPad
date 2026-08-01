/*
 * The contents of `.gitpad/config.json`.
 *
 * Versioned from the first release so a future format change is a migration
 * rather than an excavation.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export interface VaultConfig {
  readonly schemaVersion: number;

  /** ISO 8601, UTC. */
  readonly createdAt: string;

  /**
   * True when the user explicitly adopted a git repository GitPad did not
   * create -- for example a folder inside an existing code project.
   *
   * Recorded rather than re-derived because the consent was given once, in a
   * dialog, and sync must be able to check it later without asking again.
   */
  readonly adoptedForeignRepo?: boolean;
}

export function createVaultConfig(
  createdAt: string,
  options: { readonly adoptedForeignRepo?: boolean } = {},
): VaultConfig {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt,
    ...(options.adoptedForeignRepo === true ? { adoptedForeignRepo: true } : {}),
  };
}

/**
 * Parses a config file, returning `undefined` rather than throwing when it is
 * missing fields or is not valid JSON.
 *
 * A hand-edited or half-written config should degrade to "this folder is not a
 * recognised vault", which the setup flow can recover from. Throwing here would
 * mean a stray character in a JSON file leaves the extension unable to start.
 */
export function parseVaultConfig(raw: string): VaultConfig | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }

  const candidate = parsed as Partial<VaultConfig>;

  if (typeof candidate.schemaVersion !== 'number' || typeof candidate.createdAt !== 'string') {
    return undefined;
  }

  return {
    schemaVersion: candidate.schemaVersion,
    createdAt: candidate.createdAt,
    ...(candidate.adoptedForeignRepo === true ? { adoptedForeignRepo: true } : {}),
  };
}
