/*
 * The vault selection screen.
 *
 * Serves two situations: first run, when there is no vault at all, and
 * switching, when there already is one. The difference is `onCancel` -- when a
 * vault is already open there must be a way back to it, or choosing "Change"
 * by accident traps you in a dialog with no exit.
 */

interface WelcomeViewProps {
  readonly onCreate: () => void;
  readonly onOpen: () => void;
  /** Provided only when a vault is already open, and switching is optional. */
  readonly onCancel?: () => void;
}

export function WelcomeView({ onCreate, onOpen, onCancel }: WelcomeViewProps) {
  const switching = onCancel !== undefined;

  return (
    <div className="welcome">
      <h1 className="welcome__title">{switching ? 'Choose a vault' : 'No vault yet'}</h1>

      <p className="welcome__body">
        {switching
          ? 'Pick a different folder for your notes. Nothing in your current vault is moved or changed.'
          : 'Your notes live in a folder you choose — plain files you keep, separate from whatever project you have open.'}
      </p>

      <div className="welcome__actions">
        <button type="button" className="button" onClick={onCreate}>
          Create a vault
        </button>

        <button type="button" className="button button--secondary" onClick={onOpen}>
          Open existing folder
        </button>

        {/*
          Shown but disabled: cloning is git, and git arrives in Phase 2. Left
          visible so the path is discoverable now rather than appearing later
          with no explanation.
        */}
        <button type="button" className="button button--secondary" disabled title="Arrives with sync">
          Clone a repository
        </button>

        {switching ? (
          <button type="button" className="button button--secondary" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>

      <p className="hint">Cloning arrives with sync, in a later release.</p>
    </div>
  );
}
