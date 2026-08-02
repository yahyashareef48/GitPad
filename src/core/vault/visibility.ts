import { METADATA_DIR, ORDER_FILENAME, TRASH_DIR } from './VaultLayout';

/*
 * What the sidebar shows.
 *
 * The rule is deliberately blunt: folders and known document types are shown,
 * everything else is hidden. Hiding is a VIEW filter only -- a file GitPad does
 * not display is still committed and still backed up, because refusing to sync
 * something the user deliberately put in their vault would be worse than
 * showing them a tidy list.
 */

/**
 * Hidden by exact name, never by "does this folder contain anything visible".
 *
 * The contents-based rule seems smarter until a folder you just created
 * flickers out of existence because you have not put anything in it yet.
 * Predictable beats clever.
 */
const HIDDEN_NAMES: ReadonlySet<string> = new Set([
  '.git',
  '.gitignore',
  '.gitattributes',
  METADATA_DIR,
  TRASH_DIR,
  ORDER_FILENAME,
  // Reserved for local attachments. Unused until uploads land, hidden now so
  // it does not appear as a stray folder the day it does.
  'assets',
]);

export function isHiddenName(name: string): boolean {
  return HIDDEN_NAMES.has(name);
}

/** Folders are shown unless explicitly hidden by name. */
export function isVisibleFolder(name: string): boolean {
  return !isHiddenName(name);
}

/**
 * Files are shown only when a registered document type claims their extension.
 *
 * `extensions` comes from the DocumentTypeRegistry, so adding boards in Phase 3
 * makes them appear here with no change to this function.
 */
export function isVisibleFile(name: string, extensions: ReadonlySet<string>): boolean {
  if (isHiddenName(name)) {
    return false;
  }

  const dot = name.lastIndexOf('.');

  // No extension at all, or a dotfile like `.env` where the dot leads.
  if (dot <= 0) {
    return false;
  }

  return extensions.has(name.slice(dot).toLowerCase());
}

/** Display name for a file: the stem, since the title IS the filename. */
export function displayName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');

  return dot <= 0 ? fileName : fileName.slice(0, dot);
}
