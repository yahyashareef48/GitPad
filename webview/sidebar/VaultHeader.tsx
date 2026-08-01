/*
 * Shows which vault is open, and offers a way out of it.
 *
 * Without this the vault is chosen once and then invisible: the welcome screen
 * disappears after setup, so there is no way to tell which folder GitPad is
 * showing, or to point it somewhere else, short of editing settings by hand.
 */

interface VaultHeaderProps {
  readonly root: string;
  readonly onChange: () => void;
}

export function VaultHeader({ root, onChange }: VaultHeaderProps) {
  return (
    <header className="vault-header">
      {/* The full path is the tooltip: a sidebar is narrow, and the folder
          name is what identifies a vault day to day. */}
      <span className="vault-header__name" title={root}>
        {basename(root)}
      </span>

      <button type="button" className="icon-button" title="Open a different vault" onClick={onChange}>
        Change
      </button>
    </header>
  );
}

/** Last path segment. Hand-rolled because node:path does not exist in a webview. */
function basename(fullPath: string): string {
  const segments = fullPath.split(/[\\/]/).filter((segment) => segment !== '');

  return segments[segments.length - 1] ?? fullPath;
}
