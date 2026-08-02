import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';

/*
 * Makes `[[Note title]]` look and behave like a link.
 *
 * Implemented as DECORATIONS, not as a new node type. A node would need its
 * own markdown serializer, and every serializer is a chance to write something
 * the parser reads back differently -- the exact failure plan 2.4 forbids.
 * Decorations leave the document as plain text, so the markdown is whatever
 * the user typed and the round trip is unchanged by construction.
 */

export const wikilinkPluginKey = new PluginKey<DecorationSet>('gitpad-wikilink');

/** Matches `[[target]]` and `[[target|label]]`. Mirrors core/links/wikilink. */
const WIKILINK = /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;

export function createWikilinkPlugin(onOpen: (target: string) => void): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: wikilinkPluginKey,

    state: {
      init: (_config, state) => decorate(state.doc),
      // Only the document affects where links are; the caret does not, because
      // the syntax stays hidden regardless of where it sits.
      apply: (tr, previous) => (tr.docChanged ? decorate(tr.doc) : previous),
    },

    props: {
      decorations(state) {
        return wikilinkPluginKey.getState(state);
      },

      handleClick(_view, _pos, event) {
        const element = (event.target as HTMLElement | null)?.closest('.gitpad-wikilink');
        const target = element instanceof HTMLElement ? element.dataset.wikilinkTarget : undefined;

        if (target === undefined || target === '') {
          return false;
        }

        /*
         * A plain click navigates, as it does in Obsidian and Notion.
         *
         * Requiring Ctrl was defensible -- the link sits in editable text, so
         * navigating costs you the ability to click into it -- but it is not
         * what anyone expects. Editing is still reachable: the brackets are
         * revealed when the caret is inside the link, and arrow keys reach it.
         */
        onOpen(target);

        return true;
      },
    },
  });
}

/**
 * Builds the decorations.
 *
 * A link is drawn as three ranges rather than one: the opening syntax, the
 * visible label, and the closing syntax. The syntax ranges are ALWAYS hidden,
 * so a link reads as a note and never as punctuation -- including while the
 * caret is inside it.
 *
 * The text itself is untouched, so the file on disk still contains ordinary
 * `[[Note]]` markdown, and the hidden characters remain addressable for
 * backspace and selection.
 */
function decorate(doc: ProseNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos, parent) => {
    if (!node.isText || node.text === null || node.text === undefined) {
      return;
    }

    // Code spans and code blocks are text too, and a note explaining the
    // syntax must not sprout links. Mirrors the same rule in the index.
    if (parent?.type.spec.code === true || node.marks.some((mark) => mark.type.spec.code === true)) {
      return;
    }

    for (const match of node.text.matchAll(WIKILINK)) {
      if (match.index === undefined) {
        continue;
      }

      const target = match[1]?.trim();

      if (target === undefined || target === '') {
        continue;
      }

      const from = pos + match.index;
      const to = from + match[0].length;

      // Everything up to the label: `[[` alone, or `[[target|` when the link
      // carries a display label.
      const labelLength = (match[2] ?? match[1] ?? '').length;
      const labelFrom = to - 2 - labelLength;

      decorations.push(
        Decoration.inline(from, labelFrom, { class: 'gitpad-wikilink__syntax' }),
        Decoration.inline(labelFrom, to - 2, {
          class: 'gitpad-wikilink',
          'data-wikilink-target': target,
          title: `Open “${target}”`,
        }),
        Decoration.inline(to - 2, to, { class: 'gitpad-wikilink__syntax' }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}
