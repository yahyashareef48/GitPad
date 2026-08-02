import { useEffect, useState } from 'react';

import type { HostToSettings, SettingsToHost, VaultSummaryDto } from '../../src/shared/protocol';
import { SETTINGS_GROUPS, type SettingDefinition } from '../../src/shared/settings';
import type { Bridge } from '../shared/rpc';

/*
 * GitPad's settings page.
 *
 * Exists because VS Code's settings UI is a flat list of key/value rows and
 * cannot show what this extension needs alongside them: which vault is open,
 * how big it is, and the actions that are not settings at all (plan 5.4).
 *
 * It reads and writes VS Code configuration -- it keeps no copy. Anything set
 * here stays settable in VS Code's own UI and in settings.json, and a change
 * in either place shows up in the other.
 */

interface SettingsPageProps {
  readonly bridge: Bridge<SettingsToHost, HostToSettings>;
}

export function SettingsPage({ bridge }: SettingsPageProps) {
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [vault, setVault] = useState<VaultSummaryDto | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      if (message.type === 'state') {
        setValues({ ...message.values });
        setVault(message.vault);
        setLoaded(true);
      }
    });

    bridge.post({ type: 'ready' });

    return unsubscribe;
  }, [bridge]);

  const update = (key: string, value: string | number | boolean): void => {
    // Applied locally at once so the control does not feel laggy, then sent.
    // The host echoes the whole state back, which corrects anything it
    // rejected or clamped.
    setValues((previous) => ({ ...previous, [key]: value }));
    bridge.post({ type: 'set', key, value });
  };

  if (!loaded) {
    return <p className="loading">Loading…</p>;
  }

  return (
    <div className="settings">
      <h1 className="settings__title">GitPad</h1>

      <section className="settings__group">
        <h2 className="settings__heading">Vault</h2>

        {vault === undefined ? (
          <p className="settings__empty">No vault is open.</p>
        ) : (
          <>
            <div className="settings__row">
              <div className="settings__label">
                <span>Location</span>
                <span className="settings__description">{vault.root}</span>
              </div>
            </div>

            <div className="settings__row">
              <div className="settings__label">
                <span>Contents</span>
                <span className="settings__description">
                  {vault.noteCount} note{vault.noteCount === 1 ? '' : 's'} ·{' '}
                  {formatBytes(vault.sizeBytes)}
                  {vault.trashCount > 0 ? ` · ${vault.trashCount} in trash` : ''}
                </span>
              </div>
            </div>
          </>
        )}

        <div className="settings__actions">
          <button
            type="button"
            className="button"
            onClick={() => bridge.post({ type: 'action', action: 'changeVault' })}
          >
            Change vault
          </button>

          <button
            type="button"
            className="button button--secondary"
            disabled={vault === undefined}
            onClick={() => bridge.post({ type: 'action', action: 'revealVault' })}
          >
            Show in file manager
          </button>
        </div>
      </section>

      {SETTINGS_GROUPS.map((group) => (
        <section key={group.title} className="settings__group">
          <h2 className="settings__heading">{group.title}</h2>

          {group.settings.map((setting) => (
            <Row
              key={setting.key}
              setting={setting}
              value={values[setting.key]}
              onChange={(value) => update(setting.key, value)}
            />
          ))}
        </section>
      ))}

      <section className="settings__group">
        <h2 className="settings__heading">Maintenance</h2>

        {/* Actions, not settings -- the reason this page exists rather than
            relying on VS Code's settings UI. */}
        <div className="settings__actions">
          <button
            type="button"
            className="button button--secondary"
            disabled={vault === undefined || vault.trashCount === 0}
            onClick={() => bridge.post({ type: 'action', action: 'emptyTrash' })}
          >
            Empty trash
          </button>

          <button
            type="button"
            className="button button--secondary"
            disabled={vault === undefined}
            onClick={() => bridge.post({ type: 'action', action: 'rebuildSearch' })}
          >
            Rebuild search index
          </button>
        </div>
      </section>

      <p className="settings__footnote">
        These are ordinary VS Code settings.{' '}
        <button
          type="button"
          className="settings__link"
          onClick={() => bridge.post({ type: 'action', action: 'openVsCodeSettings' })}
        >
          Open them in VS Code’s settings editor
        </button>{' '}
        if you prefer, or edit settings.json directly — all three stay in step.
      </p>
    </div>
  );
}

interface RowProps {
  readonly setting: SettingDefinition;
  readonly value: string | number | boolean | undefined;
  readonly onChange: (value: string | number | boolean) => void;
}

function Row({ setting, value, onChange }: RowProps) {
  return (
    <div className="settings__row">
      <label className="settings__label" htmlFor={setting.key}>
        <span>{setting.label}</span>
        <span className="settings__description">{setting.description}</span>
      </label>

      {setting.kind === 'boolean' ? (
        <input
          id={setting.key}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : null}

      {setting.kind === 'number' ? (
        <input
          id={setting.key}
          type="number"
          className="settings__input"
          min={setting.min}
          value={typeof value === 'number' ? value : 0}
          onChange={(event) => {
            const next = Number(event.target.value);

            // Ignored rather than clamped while typing: clamping mid-edit
            // fights someone clearing the field to retype it.
            if (!Number.isNaN(next)) {
              onChange(next);
            }
          }}
        />
      ) : null}

      {setting.kind === 'choice' ? (
        <select
          id={setting.key}
          className="settings__input"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        >
          {(setting.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} kB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
