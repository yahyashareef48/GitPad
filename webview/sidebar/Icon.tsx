/*
 * A codicon.
 *
 * Codicons are VS Code's own icon font, so these are literally the glyphs the
 * rest of the editor draws -- not lookalikes that go subtly out of step with
 * the surrounding chrome at different zoom levels or themes.
 *
 * Names come from https://microsoft.github.io/vscode-codicons/dist/codicon.html
 */

export type IconName =
  | 'new-file'
  | 'new-folder'
  | 'gear'
  | 'ellipsis'
  | 'chevron-right'
  | 'chevron-down'
  | 'file'
  | 'folder'
  | 'folder-opened'
  | 'search'
  | 'close'
  | 'trash'
  | 'discard';

interface IconProps {
  readonly name: IconName;
  /** Set when the icon stands alone and carries the meaning. */
  readonly label?: string;
}

export function Icon({ name, label }: IconProps) {
  return (
    <i
      className={`codicon codicon-${name}`}
      // Decorative by default: most icons here sit next to text or inside a
      // button that already has a title, and announcing them twice is noise.
      aria-hidden={label === undefined}
      aria-label={label}
      role={label === undefined ? undefined : 'img'}
    />
  );
}
