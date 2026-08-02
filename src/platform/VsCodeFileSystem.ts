import * as vscode from 'vscode';

import type { FileEntry, FileStat, FileSystem } from '../core/ports/FileSystem';

/*
 * FileSystem port backed by `vscode.workspace.fs`.
 *
 * Deliberately not node:fs. workspace.fs routes through VS Code's filesystem
 * providers, so a vault on a Remote SSH host, in WSL, or in a Codespace works
 * with no special handling. node:fs would silently only ever see the local
 * disk of whichever machine the extension host happens to run on.
 */
export class VsCodeFileSystem implements FileSystem {
  public async readFile(path: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(vscode.Uri.file(path));
  }

  public async writeFile(path: string, contents: Uint8Array): Promise<void> {
    // workspace.fs.writeFile creates missing parent directories itself.
    await vscode.workspace.fs.writeFile(vscode.Uri.file(path), contents);
  }

  public async readDirectory(path: string): Promise<readonly FileEntry[]> {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path));

    return entries.map(([name, type]) => ({
      name,
      kind: toFileKind(type),
    }));
  }

  public async createDirectory(path: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path));
  }

  public async delete(path: string, options?: { readonly recursive?: boolean }): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(path), {
      recursive: options?.recursive ?? false,
      // GitPad does its own soft-delete into .trash/, so the OS recycle bin
      // would be a second, confusing layer of undo.
      useTrash: false,
    });
  }

  public async rename(from: string, to: string): Promise<void> {
    await vscode.workspace.fs.rename(vscode.Uri.file(from), vscode.Uri.file(to), {
      overwrite: false,
    });
  }

  public async stat(path: string): Promise<FileStat | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(path));

      return {
        kind: toFileKind(stat.type),
        size: stat.size,
        modifiedAt: stat.mtime,
      };
    } catch (error) {
      // A missing path is an expected answer, not a failure -- see the port.
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return undefined;
      }

      throw error;
    }
  }
}

/**
 * `vscode.FileType` is a bitmask: a symlink to a directory is
 * `SymbolicLink | Directory`. Masking rather than comparing means symlinked
 * folders in a vault behave like folders instead of being silently skipped.
 */
function toFileKind(type: vscode.FileType): FileEntry['kind'] {
  return (type & vscode.FileType.Directory) !== 0 ? 'directory' : 'file';
}
