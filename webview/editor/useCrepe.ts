import { Crepe } from '@milkdown/crepe';
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { replaceAll } from '@milkdown/kit/utils';
import { useEffect, useRef, useState } from 'react';

import { REMARK_STRINGIFY_OPTIONS } from '../../src/shared/remarkSettings';

/*
 * Mounts a Crepe editor into a DOM node and keeps it in step with the host.
 *
 * Crepe is vanilla, not React, so its lifecycle is managed by hand here rather
 * than expressed as components. Keeping that in one hook means the rest of the
 * editor UI never has to think about it.
 */

interface UseCrepeOptions {
  /** Initial markdown. `undefined` means the host has not answered yet. */
  readonly initial: string | undefined;
  /** Called when the user changes the document. Not called for remote updates. */
  readonly onChange: (markdown: string) => void;
}

export function useCrepe({ initial, onChange }: UseCrepeOptions) {
  const container = useRef<HTMLDivElement>(null);
  const crepe = useRef<Crepe | undefined>(undefined);
  const [ready, setReady] = useState(false);

  /*
   * Held in a ref so the effect that creates the editor does not depend on it.
   *
   * `onChange` is a new function on every render; if the effect depended on it
   * the editor would be destroyed and rebuilt constantly, losing focus and
   * cursor position with every keystroke.
   */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /*
   * Set while applying markdown that came FROM the host -- undo, redo, revert,
   * or an external file change. Without it, replacing the content would fire
   * markdownUpdated and be reported straight back as a user edit, so undo
   * would re-record itself and appear to do nothing.
   */
  const applyingRemote = useRef(false);

  useEffect(() => {
    const root = container.current;

    if (root === null || initial === undefined || crepe.current !== undefined) {
      return;
    }

    const editor = new Crepe({
      root,
      defaultValue: initial,
      features: {
        // Needs a service and an API key; out of scope entirely.
        [Crepe.Feature.AI]: false,
        /*
         * Off until remark-math is part of the pipeline. A block the editor
         * can create but the markdown cannot express is a block that silently
         * vanishes on save -- the hard rule in plan 2.4.
         */
        [Crepe.Feature.Latex]: false,
        // GitPad's title is the filename, shown in the tab. A second title
        // inside the document would be a second source of truth.
        [Crepe.Feature.TopBar]: false,
      },
      featureConfigs: {
        [Crepe.Feature.ImageBlock]: {
          /*
           * File upload is deliberately out of scope (plan 2.5), so these
           * reject rather than half-working. Images are added by URL.
           *
           * The upload BUTTON is hidden in crepe-theme.css; these strings
           * reword what remains, because "or paste link" on its own reads as
           * the tail of a sentence whose first half has been removed.
           */
          onUpload: rejectUpload,
          inlineOnUpload: rejectUpload,
          blockOnUpload: rejectUpload,
          blockUploadPlaceholderText: 'Paste an image link',
          inlineUploadPlaceholderText: 'Paste an image link',
          blockUploadButton: '',
          inlineUploadButton: '',
        },
        [Crepe.Feature.Placeholder]: {
          text: 'Start writing…',
        },
      },
    });

    crepe.current = editor;

    /*
     * Pin how markdown is written out.
     *
     * Without this, remark-stringify rewrites constructs it did not author --
     * `---` becomes `***`, bullets and emphasis markers flip. Nothing is lost,
     * but opening and saving a note produces a diff the user did not make, and
     * once sync exists, a commit of it. The round-trip corpus uses the same
     * options, so the test measures what the editor actually does.
     */
    editor.editor.config((ctx) => {
      ctx.set(remarkStringifyOptionsCtx, REMARK_STRINGIFY_OPTIONS);
    });

    editor.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        if (applyingRemote.current) {
          return;
        }

        onChangeRef.current(markdown);
      });
    });

    void editor.create().then(() => {
      setReady(true);
    });

    return () => {
      crepe.current = undefined;
      void editor.destroy();
    };
    // `initial` is the trigger to build, but changes to it afterwards go
    // through setMarkdown -- rebuilding would throw away the user's cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial !== undefined]);

  /** Replaces the document without reporting it back as a user edit. */
  const setMarkdown = (markdown: string): void => {
    const editor = crepe.current;

    if (editor === undefined || markdown === editor.getMarkdown()) {
      return;
    }

    applyingRemote.current = true;

    try {
      editor.editor.action(replaceAll(markdown));
    } finally {
      applyingRemote.current = false;
    }
  };

  return { container, ready, setMarkdown };
}

async function rejectUpload(): Promise<string> {
  throw new Error('Uploading files is not supported yet. Paste an image URL instead.');
}
