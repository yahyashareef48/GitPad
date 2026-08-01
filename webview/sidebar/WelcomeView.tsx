/*
 * Shown when no vault is configured.
 *
 * This is the first thing a new user sees, so it states where notes will live
 * before asking them to choose -- the folder decision is one people regret
 * quietly, and it is much cheaper to get right up front than to move later.
 */

interface WelcomeViewProps {
  readonly onCreate: () => void;
  readonly onOpen: () => void;
}

export function WelcomeView({ onCreate, onOpen }: WelcomeViewProps) {
  return (
    <div className="welcome">
      <h1 className="welcome__title">No vault yet</h1>

      <p className="welcome__body">
        Your notes live in a folder you choose — plain files you keep, separate from whatever
        project you have open.
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
      </div>

      <p className="hint">Cloning arrives with sync, in a later release.</p>
    </div>
  );
}
