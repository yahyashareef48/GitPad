import * as path from 'node:path';

import type { FileSystem } from '../ports/FileSystem';
import { CONFIG_FILENAME, METADATA_DIR } from './VaultLayout';

/*
 * Deciding what a chosen folder actually is, before GitPad starts writing to it.
 *
 * The case this exists for: someone points GitPad at a folder inside their code
 * project. Left unchecked, GitPad would auto-commit their uncommitted source
 * every five seconds onto whatever branch is checked out, stamp its co-author
 * trailer on their real commits, and force-push during history compaction.
 * Meanwhile the sidebar shows nothing, because everything that is not a `.pad`
 * file is filtered out -- so it looks broken while consuming their repo.
 */

export type VaultCandidate =
  /** No git anywhere above it, and no vault config. Safe to initialise. */
  | { readonly kind: 'new' }
  /** Already a GitPad vault. Safe to adopt -- this is the second-device path. */
  | { readonly kind: 'vault'; readonly root: string }
  /** Inside a git repository that is not a GitPad vault. Requires consent. */
  | { readonly kind: 'foreign-repo'; readonly repoRoot: string };

export async function detectVaultCandidate(
  folder: string,
  fs: FileSystem,
): Promise<VaultCandidate> {
  const [gitRoot, isVault] = await Promise.all([
    findGitRoot(folder, fs),
    hasVaultConfig(folder, fs),
  ]);

  if (gitRoot === undefined) {
    // No repository involved at all: either an existing vault not yet under
    // git, or a plain folder.
    return isVault ? { kind: 'vault', root: folder } : { kind: 'new' };
  }

  /*
   * A folder only counts as a vault when it is ALSO the repository root.
   *
   * A vault nested inside someone else's repo (`myapp/notes/` with its own
   * .gitpad/) still has all the problems above: sync operates on the whole
   * repository, not on a subdirectory, so committing would sweep up the
   * surrounding project.
   */
  if (path.resolve(gitRoot) === path.resolve(folder) && isVault) {
    return { kind: 'vault', root: folder };
  }

  return { kind: 'foreign-repo', repoRoot: gitRoot };
}

/**
 * Walks up from `start` looking for a repository root.
 *
 * Must check ancestors, not just the chosen folder: the common way to hit this
 * is picking `~/projects/myapp/notes`, which has no `.git` of its own but sits
 * inside one.
 */
async function findGitRoot(start: string, fs: FileSystem): Promise<string | undefined> {
  let current = path.resolve(start);

  for (;;) {
    // `.git` is a directory in a normal clone but a FILE in a worktree or
    // submodule, so this checks for existence rather than for a directory.
    if ((await fs.stat(path.join(current, '.git'))) !== undefined) {
      return current;
    }

    const parent = path.dirname(current);

    // dirname() of a filesystem root returns the root itself.
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

async function hasVaultConfig(folder: string, fs: FileSystem): Promise<boolean> {
  const stat = await fs.stat(path.join(folder, METADATA_DIR, CONFIG_FILENAME));

  return stat?.kind === 'file';
}
