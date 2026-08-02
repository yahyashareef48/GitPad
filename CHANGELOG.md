# Change Log

## [0.1.0] — 2026-08-02

First working release. Phase 1: a local notes workspace. Git sync arrives in Phase 2.

### Notes and the vault

- Pick any folder as your vault. It is deliberately separate from whatever project you have open,
  and GitPad warns before adopting a folder inside an existing Git repository.
- Sidebar with folders, drag to reorder or move, rename, duplicate, and delete.
- Notes are `.pad` files containing ordinary GitHub-flavored markdown. Rename them to `.md` and they
  open anywhere.
- The note's title **is** its filename, editable from the top of the editor.

### Editor

- Rich editing via Milkdown's Crepe: slash menu, block handles, drag-to-reorder, selection toolbar,
  tables, checkboxes, and code blocks with syntax highlighting.
- Follows your VS Code theme — no colours of its own.
- Saves automatically. VS Code's own auto-save does not apply to custom editors, so GitPad has its
  own setting.
- Undo, redo, dirty indicator and hot exit all behave like a native editor.
- A note changed on disk reloads; if you have unsaved edits it asks rather than choosing for you.

### Finding things

- Filter box in the sidebar matches note titles instantly.
- Full-text search across note contents — `Ctrl+Alt+F`, ranked, with excerpts.
- Recently opened list, stored per machine and never synced.

### Safety

- Deleting moves to `.trash/`, which mirrors your folder structure, so restoring puts a note back
  where it came from — recreating its folder if that was deleted too.
- Restore, delete permanently, or empty the trash from the sidebar.
- Markdown is written with pinned formatting options, so opening and saving a note does not rewrite
  what you typed.

### Settings

- A dedicated settings page: vault summary, editor and sidebar options, and maintenance actions.
  It reads and writes ordinary VS Code settings, so it and the settings editor always agree.

### Known limitations

- **No Git sync yet.** That is Phase 2.
- **`[[Wikilinks]]` are built but switched off.** The behaviour around duplicate titles, deleted
  targets and renamed folders is not settled, and a link you cannot trust is worse than none.
- **Images are external URLs only.** Local file upload is deliberately out of scope for now, and
  large images can overflow the editor.
- **No `.md` import/export command.** Notes are already markdown, so renaming the extension is the
  whole story.
