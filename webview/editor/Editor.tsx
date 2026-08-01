import { useEffect, useRef, useState } from 'react';

import type { EditorToHost, HostToEditor } from '../../src/shared/protocol';
import type { Bridge } from '../shared/rpc';

/*
 * The editing surface -- a plain textarea, deliberately.
 *
 * M2 proves the custom editor plumbing works: document lifecycle, dirty state,
 * save, and the undo bridge. Milkdown arrives in M3 on top of a foundation
 * already known to be sound, so that a misbehaving Ctrl+Z has one suspect
 * rather than two.
 */

/**
 * How long typing pauses before an edit is reported.
 *
 * Every reported edit becomes one Ctrl+Z step. Reporting per keystroke would
 * make undo remove one character at a time, which nobody wants; waiting for a
 * pause groups a burst of typing into a single, useful undo unit.
 */
const EDIT_DEBOUNCE_MS = 400;

interface EditorProps {
  readonly bridge: Bridge<EditorToHost, HostToEditor>;
}

export function Editor({ bridge }: EditorProps) {
  const [text, setText] = useState<string | undefined>(undefined);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /*
   * Set while applying text that came FROM the host (undo, redo, revert, an
   * external file change). Without it, applying that text would schedule an
   * `edit` back to the host, and undo would immediately re-record itself as a
   * brand new change -- making Ctrl+Z appear to do nothing.
   */
  const applyingRemote = useRef(false);

  useEffect(() => {
    const unsubscribe = bridge.onMessage((message) => {
      switch (message.type) {
        case 'init':
          setText(message.text);
          break;

        case 'setText':
          applyingRemote.current = true;
          setText(message.text);
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
  }, [bridge]);

  /*
   * Restores the caret after remote text is applied.
   *
   * Replacing a textarea's value sends the caret to the end. During undo that
   * throws the user to the bottom of the note on every step, which makes
   * repeated undo unusable.
   */
  useEffect(() => {
    if (!applyingRemote.current) {
      return;
    }

    applyingRemote.current = false;

    const element = textareaRef.current;

    if (element !== null && text !== undefined) {
      const caret = Math.min(element.selectionStart, text.length);

      element.setSelectionRange(caret, caret);
    }
  }, [text]);

  if (text === undefined) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <textarea
      ref={textareaRef}
      className="editor"
      value={text}
      spellCheck
      onChange={(event) => {
        const next = event.target.value;
        setText(next);

        if (pending.current !== undefined) {
          clearTimeout(pending.current);
        }

        pending.current = setTimeout(() => {
          bridge.post({ type: 'edit', text: next });
        }, EDIT_DEBOUNCE_MS);
      }}
      onBlur={() => {
        /*
         * Flush immediately on blur.
         *
         * Ctrl+S moves focus, and a save that happened before the debounce
         * fired would write the previous text -- losing the last few
         * characters typed.
         */
        if (pending.current !== undefined) {
          clearTimeout(pending.current);
          pending.current = undefined;
          bridge.post({ type: 'edit', text });
        }
      }}
    />
  );
}
