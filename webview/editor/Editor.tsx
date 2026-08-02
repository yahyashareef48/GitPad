import { useEffect, useRef, useState } from 'react';

import type {
  EditorToHost,
  HostToEditor,
  LinkTargetDto,
  NoteMetaDto,
} from '../../src/shared/protocol';
import type { Bridge } from '../shared/rpc';
import { NoteHeader } from './NoteHeader';
import { WikilinkSuggest, useMatches } from './WikilinkSuggest';
import { useCrepe } from './useCrepe';
import { completeWikilink, type SuggestState } from './suggestPlugin';

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

/**
 * Text size is a data attribute on the root, not React state.
 *
 * The CSS variable it selects cascades into Crepe's own DOM, which React does
 * not own -- Crepe renders itself. An attribute reaches all of it; a prop
 * would only reach the parts we render.
 */
function applyTextSize(size: string): void {
  document.documentElement.dataset.gitpadSize = size;
}

export function Editor({ bridge }: EditorProps) {
  const [initial, setInitial] = useState<string | undefined>(undefined);
  const [meta, setMeta] = useState<NoteMetaDto | undefined>(undefined);
  const [titles, setTitles] = useState<readonly LinkTargetDto[]>([]);
  const [suggest, setSuggest] = useState<SuggestState | undefined>(undefined);
  const [highlighted, setHighlighted] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<string | undefined>(undefined);

  const { container, ready, setMarkdown, getView } = useCrepe({
    initial,
    onOpenWikilink: (target) => bridge.post({ type: 'openWikilink', target }),
    suggest: {
      onChange: (next) => {
        setSuggest(next);
        // Reset to the top whenever the query changes, so the first result
        // is what Enter takes.
        setHighlighted(0);
      },
      onKeyDown: (key) => suggestKeyRef.current(key),
    },
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
          setMeta(message.meta);
          applyTextSize(message.textSize);
          break;

        case 'meta':
          setMeta(message.meta);
          break;

        case 'noteTitles':
          setTitles(message.titles);
          break;

        case 'settings':
          applyTextSize(message.textSize);
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

  const matches = useMatches(titles, suggest?.query ?? '');

  const insert = (entry: LinkTargetDto): void => {
    const view = getView();

    if (view !== undefined && suggest !== undefined) {
      // `insert`, not `title`: path-qualified when the title is ambiguous.
      completeWikilink(view, suggest, entry.insert);
    }

    setSuggest(undefined);
  };

  /*
   * Keyboard handling for the popup.
   *
   * Held in a ref because the ProseMirror plugin captures the handler once,
   * while this closure changes with every render as the query and highlight
   * move. Without the ref the plugin would call a stale version.
   */
  const suggestKeyRef = useRef<(key: string) => boolean>(() => false);

  suggestKeyRef.current = (key: string): boolean => {
    if (suggest === undefined) {
      return false;
    }

    if (key === 'Escape') {
      setSuggest(undefined);
      return true;
    }

    if (key === 'ArrowDown') {
      setHighlighted((index) => (index + 1) % Math.max(matches.length, 1));
      return true;
    }

    if (key === 'ArrowUp') {
      setHighlighted((index) => (index - 1 + matches.length) % Math.max(matches.length, 1));
      return true;
    }

    if (key === 'Enter' || key === 'Tab') {
      const entry = matches[highlighted];

      // With no match, Enter is left alone: the user is naming a note that
      // does not exist yet, and typing should not be hijacked.
      if (entry === undefined) {
        return false;
      }

      insert(entry);
      return true;
    }

    return false;
  };

  return (
    <div className="page">
      {initial === undefined || !ready ? <div className="loading">Loading…</div> : null}

      {meta === undefined ? null : (
        <NoteHeader meta={meta} onRename={(title) => bridge.post({ type: 'rename', title })} />
      )}

      <div className="crepe" ref={container} />

      {suggest === undefined ? null : (
        <WikilinkSuggest
          state={suggest}
          titles={titles}
          selected={highlighted}
          onSelect={insert}
          onHighlight={setHighlighted}
        />
      )}
    </div>
  );
}
