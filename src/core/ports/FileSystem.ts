/*
 * Filesystem access, as the domain sees it.
 *
 * core/ never imports `vscode` (enforced by eslint.config.mjs), so everything
 * it needs from the outside world arrives through a port like this one. The
 * real implementation lives in platform/VsCodeFileSystem.ts; tests substitute
 * an in-memory fake and run in plain Node with no extension host.
 *
 * Paths are plain strings rather than vscode.Uri for the same reason -- Uri is
 * a vscode type and cannot appear here. VaultLayout owns turning vault-relative
 * paths into absolute ones; this port only ever sees absolute paths.
 */

export type FileKind = 'file' | 'directory';

export interface FileEntry {
  readonly name: string;
  readonly kind: FileKind;
}

export interface FileStat {
  readonly kind: FileKind;
  readonly size: number;
  /**
   * Milliseconds since epoch.
   *
   * Deliberately NOT used to order notes: git does not preserve timestamps, so
   * on a freshly cloned vault every file reports as modified at checkout time.
   * Note dates live in frontmatter instead -- see plan section 2.7.
   */
  readonly modifiedAt: number;
}

export interface FileSystem {
  readFile(path: string): Promise<Uint8Array>;

  /** Creates parent directories as needed. */
  writeFile(path: string, contents: Uint8Array): Promise<void>;

  readDirectory(path: string): Promise<readonly FileEntry[]>;

  createDirectory(path: string): Promise<void>;

  delete(path: string, options?: { readonly recursive?: boolean }): Promise<void>;

  rename(from: string, to: string): Promise<void>;

  /**
   * Returns `undefined` when the path does not exist, rather than throwing.
   *
   * "Does this exist?" is a routine question here (uniquifying filenames,
   * checking for `.gitpad/config.json`, detecting a foreign git repo) and
   * routine questions should not be answered with exceptions.
   */
  stat(path: string): Promise<FileStat | undefined>;
}
