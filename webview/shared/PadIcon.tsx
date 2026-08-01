/*
 * GitPad's mark, as an inline SVG.
 *
 * Inline rather than an <img> so it can be sized with CSS and inherit colour
 * where wanted -- and so it needs no entry in localResourceRoots, which an
 * image file would.
 *
 * Kept in webview/shared because both the sidebar and the editor use it, and
 * a note should look like the same thing in both.
 */

interface PadIconProps {
  /** Rendered size in pixels. Square. */
  readonly size?: number;
  /** Brand colour by default; pass `currentColor` to inherit. */
  readonly color?: string;
}

export function PadIcon({ size = 16, color = '#F05133' }: PadIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="48 48 156 156"
      role="img"
      aria-label="GitPad note"
      style={{ flex: '0 0 auto' }}
    >
      <g fill="none" stroke={color} strokeWidth={20} strokeLinecap="round">
        <path d="M150,182 A62,62 0 1 1 184,112" />
        <path d="M184,112 V150" />
      </g>
      <circle cx="184" cy="160" r="16" fill={color} />
    </svg>
  );
}
