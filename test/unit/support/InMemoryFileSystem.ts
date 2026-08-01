import * as path from 'node:path';

import type { FileEntry, FileStat, FileSystem } from '../../../src/core/ports/FileSystem';

/*
 * A FileSystem port implementation backed by a Map.
 *
 * This is the payoff for the layering: domain code takes the port, so its tests
 * run here in microseconds with no temp directories to create, no cleanup to
 * forget, and no interference between parallel tests.
 */
export class InMemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>();

  public constructor(seed: Readonly<Record<string, string>> = {}) {
    for (const [filePath, contents] of Object.entries(seed)) {
      this.seedFile(filePath, contents);
    }
  }

  public seedFile(filePath: string, contents: string): void {
    const normalized = normalize(filePath);

    this.files.set(normalized, new TextEncoder().encode(contents));
    this.seedDirectory(path.dirname(normalized));
  }

  public seedDirectory(dirPath: string): void {
    let current = normalize(dirPath);

    // Directories are stored explicitly, including ancestors, so readDirectory
    // and stat behave like a real filesystem rather than inferring structure.
    for (;;) {
      this.directories.add(current);

      const parent = path.dirname(current);

      if (parent === current) {
        return;
      }

      current = parent;
    }
  }

  public has(filePath: string): boolean {
    return this.files.has(normalize(filePath));
  }

  public read(filePath: string): string {
    const contents = this.files.get(normalize(filePath));

    if (contents === undefined) {
      throw new Error(`No such file: ${filePath}`);
    }

    return new TextDecoder().decode(contents);
  }

  // ---- FileSystem port ----

  public async readFile(filePath: string): Promise<Uint8Array> {
    const contents = this.files.get(normalize(filePath));

    if (contents === undefined) {
      throw new Error(`ENOENT: ${filePath}`);
    }

    return contents;
  }

  public async writeFile(filePath: string, contents: Uint8Array): Promise<void> {
    const normalized = normalize(filePath);

    this.files.set(normalized, contents);
    this.seedDirectory(path.dirname(normalized));
  }

  public async readDirectory(dirPath: string): Promise<readonly FileEntry[]> {
    const normalized = normalize(dirPath);
    const entries = new Map<string, FileEntry>();

    for (const filePath of this.files.keys()) {
      if (path.dirname(filePath) === normalized) {
        entries.set(path.basename(filePath), { name: path.basename(filePath), kind: 'file' });
      }
    }

    for (const directory of this.directories) {
      if (directory !== normalized && path.dirname(directory) === normalized) {
        entries.set(path.basename(directory), {
          name: path.basename(directory),
          kind: 'directory',
        });
      }
    }

    return [...entries.values()];
  }

  public async createDirectory(dirPath: string): Promise<void> {
    this.seedDirectory(dirPath);
  }

  public async delete(targetPath: string, options?: { readonly recursive?: boolean }): Promise<void> {
    const normalized = normalize(targetPath);

    this.files.delete(normalized);

    if (options?.recursive === true) {
      for (const filePath of [...this.files.keys()]) {
        if (filePath.startsWith(`${normalized}${path.sep}`)) {
          this.files.delete(filePath);
        }
      }

      for (const directory of [...this.directories]) {
        if (directory === normalized || directory.startsWith(`${normalized}${path.sep}`)) {
          this.directories.delete(directory);
        }
      }
    } else {
      this.directories.delete(normalized);
    }
  }

  public async rename(from: string, to: string): Promise<void> {
    const contents = this.files.get(normalize(from));

    if (contents !== undefined) {
      this.files.delete(normalize(from));
      await this.writeFile(to, contents);
    }
  }

  public async stat(targetPath: string): Promise<FileStat | undefined> {
    const normalized = normalize(targetPath);
    const file = this.files.get(normalized);

    if (file !== undefined) {
      return { kind: 'file', size: file.byteLength, modifiedAt: 0 };
    }

    if (this.directories.has(normalized)) {
      return { kind: 'directory', size: 0, modifiedAt: 0 };
    }

    return undefined;
  }
}

function normalize(value: string): string {
  return path.resolve(value);
}
