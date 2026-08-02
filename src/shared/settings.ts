/*
 * The settings the page can edit, and their shapes.
 *
 * Shared so the page renders from the same definition the host reads and
 * writes. A page with its own hard-coded list would drift from what the
 * extension actually honours, and the drift would be invisible.
 *
 * Every value lives in VS Code configuration -- this describes it, it does not
 * store it. That is what keeps GitPad's page and VS Code's own settings UI
 * showing the same thing (plan 5.4).
 */

export type SettingValue = string | number | boolean;

export interface SettingDefinition {
  /** Full configuration key, e.g. `gitpad.editor.autoSave`. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: 'boolean' | 'number' | 'choice';
  /** Present for `choice`. */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly min?: number;
}

export interface SettingsGroup {
  readonly title: string;
  readonly settings: readonly SettingDefinition[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    title: 'Editor',
    settings: [
      {
        key: 'gitpad.editor.textSize',
        label: 'Text size',
        description: 'Headings scale with it.',
        kind: 'choice',
        options: [
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ],
      },
      {
        key: 'gitpad.editor.autoSave',
        label: 'Save automatically',
        description:
          "VS Code's own auto-save setting does not apply to notes, so this is what controls them.",
        kind: 'boolean',
      },
      {
        key: 'gitpad.editor.autoSaveDelayMs',
        label: 'Save delay',
        description: 'Milliseconds to wait after you stop typing.',
        kind: 'number',
        min: 200,
      },
    ],
  },
  {
    title: 'Sidebar',
    settings: [
      {
        key: 'gitpad.sidebar.recentlyOpenedCount',
        label: 'Recently opened',
        description: 'How many to list. Set to 0 to hide the section. Never synced.',
        kind: 'number',
        min: 0,
      },
    ],
  },
];

/** Actions the page offers that are not settings at all. */
export type SettingsAction =
  | 'changeVault'
  | 'revealVault'
  | 'emptyTrash'
  | 'rebuildSearch'
  | 'openVsCodeSettings';
