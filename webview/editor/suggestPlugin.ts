import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

/*
 * The `[[` note picker.
 *
 * Detection lives in a ProseMirror plugin because only it sees every
 * transaction; the popup itself is React, because that is what the rest of the
 * editor UI is. The plugin therefore owns WHEN to suggest and React owns WHAT
 * it looks like, communicating through a callback rather than the plugin
 * rendering DOM of its own.
 */

export interface SuggestState {
  /** Text typed after `[[`, used to filter. */
  readonly query: string;
  /** Document position of the `[[`. */
  readonly from: number;
  /** Caret position. */
  readonly to: number;
  /** Viewport coordinates of the caret, for positioning the popup. */
  readonly coords: { readonly left: number; readonly bottom: number };
}

/** Keyboard handling lives in React; the plugin defers to these. */
export interface SuggestHandlers {
  onChange: (state: SuggestState | undefined) => void;
  /** Return true to consume the key. */
  onKeyDown: (key: string) => boolean;
}

export const wikilinkSuggestKey = new PluginKey('gitpad-wikilink-suggest');

/**
 * Matches an unclosed `[[` immediately before the caret.
 *
 * The query may not contain `]` or a newline, so the suggestion closes itself
 * as soon as the link is finished or the line ends.
 */
const OPEN_LINK = /\[\[([^\]\n|]*)$/;

export function createWikilinkSuggestPlugin(handlers: SuggestHandlers): Plugin {
  let last: string | undefined;

  const publish = (view: EditorView): void => {
    const state = detect(view);
    // Compared by value: the plugin runs on every transaction, and re-rendering
    // the popup on each keystroke that did not change anything makes the list
    // flicker.
    const signature = state === undefined ? undefined : `${state.from}:${state.query}`;

    if (signature !== last) {
      last = signature;
      handlers.onChange(state);
    }
  };

  return new Plugin({
    key: wikilinkSuggestKey,

    view: (view) => {
      publish(view);

      return {
        update: (updated) => {
          publish(updated);
        },
        destroy: () => {
          handlers.onChange(undefined);
        },
      };
    },

    props: {
      handleKeyDown(_view, event) {
        // Only the keys the popup uses are consumed, and only while it is open,
        // so typing is never swallowed.
        if (last === undefined) {
          return false;
        }

        return handlers.onKeyDown(event.key);
      },
    },
  });
}

function detect(view: EditorView): SuggestState | undefined {
  const { state } = view;
  const { selection } = state;

  // A range selection is not someone typing a link.
  if (!selection.empty) {
    return undefined;
  }

  const to = selection.from;
  const parent = selection.$from.parent;

  // Not inside code: a note explaining the syntax should not offer completions.
  if (parent.type.spec.code === true) {
    return undefined;
  }

  const textBefore = state.doc.textBetween(selection.$from.start(), to, undefined, '￼');
  const match = OPEN_LINK.exec(textBefore);

  if (match === null) {
    return undefined;
  }

  const query = match[1] ?? '';
  const from = to - query.length - 2;
  const coords = view.coordsAtPos(to);

  return { query, from, to, coords: { left: coords.left, bottom: coords.bottom } };
}

/** Replaces the in-progress `[[query` with a finished `[[title]]`. */
export function completeWikilink(view: EditorView, state: SuggestState, title: string): void {
  view.dispatch(
    view.state.tr.insertText(`[[${title}]]`, state.from, state.to).scrollIntoView(),
  );

  view.focus();
}
