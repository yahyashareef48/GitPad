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
      // Only recomputed when the document actually changed; a selection move
      // does not alter where the links are.
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
         * Only a modified click navigates.
         *
         * A plain click has to keep placing the caret, because the link lives
         * in editable text -- making it navigate would leave no way to edit a
         * line that happens to contain one.
         */
        if (!event.ctrlKey && !event.metaKey) {
          return false;
        }

        onOpen(target);

        return true;
      },
    },
  });
}

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

      decorations.push(
        Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
          class: 'gitpad-wikilink',
          'data-wikilink-target': target,
          title: `Ctrl+click to open “${target}”`,
        }),
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}
