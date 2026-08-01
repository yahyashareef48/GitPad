import { useEffect, useRef, useState } from 'react';

import type { EditorToHost, HostToEditor } from '../../src/shared/protocol';
import type { Bridge } from '../shared/rpc';
import { useCrepe } from './useCrepe';

/*
 * The editing surface: Milkdown's Crepe.
 *
 * Crepe's document model is remark's markdown AST, which is why it was chosen
 * over Lexical and BlockNote -- our storage format IS markdown, so there is no
 * conversion layer to lose fidelity in (plan 2.4).
 */

/**
 * How long typing pauses before a change is reported to the host.
 *
 * Each reported change becomes one Ctrl+Z step. Reporting per keystroke makes
 * undo remove a character at a time; waiting for a pause groups a burst of
 * typing into one useful step.
 */
const EDIT_DEBOUNCE_MS = 400;

interface EditorProps {
  readonly bridge: Bridge<EditorToHost, HostToEditor>;
}

export function Editor({ bridge }: EditorProps) {
  const [initial, setInitial] = useState<string | undefined>(undefined);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<string | undefined>(undefined);

  const { container, ready, setMarkdown } = useCrepe({
    initial,
    onChange: (markdown) => {
      latest.current = markdown;

      if (pending.current !== undefined) {
        clearTimeout(pending.current);
      }

      pending.current = setTimeout(() => {
        pending.current = undefined;
        bridge.post({ type: 'edit', text: markdown });
      }, EDIT_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      switch (message.type) {
        case 'init':
          setInitial(message.text);
          break;

        case 'setText':
          /*
           * A queued edit is dropped rather than flushed.
           *
           * This message is the host correcting us -- undo, redo, revert, or
           * an external change. Sending our stale text afterwards would undo
           * the undo.
           */
          if (pending.current !== undefined) {
            clearTimeout(pending.current);
            pending.current = undefined;
          }

          setMarkdown(message.text);
          break;
      }
    });

    bridge.post({ type: 'ready' });

    return () => {
      unsubscribe();

      if (pending.current !== undefined) {
        clearTimeout(pending.current);
      }
    };
    // setMarkdown is stable for the life of the editor; including it would
    // resubscribe on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  /*
   * Flushes a queued edit when the window loses focus.
   *
   * Ctrl+S and clicking another tab both blur, and a save that landed before
   * the debounce fired would write the previous text -- losing the last few
   * characters typed.
   */
  useEffect(() => {
    const flush = () => {
      if (pending.current !== undefined && latest.current !== undefined) {
        clearTimeout(pending.current);
        pending.current = undefined;
        bridge.post({ type: 'edit', text: latest.current });
      }
    };

    window.addEventListener('blur', flush);

    return () => {
      window.removeEventListener('blur', flush);
    };
  }, [bridge]);

  return (
    <>
      {initial === undefined || !ready ? <div className="loading">Loading…</div> : null}
      <div className="crepe" ref={container} />
    </>
  );
}
