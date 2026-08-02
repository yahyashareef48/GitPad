# GitPad

A notes workspace inside VS Code. Folders, rich text, search and trash — in the sidebar, next to
your code.

Your notes are plain markdown files in a folder you choose. No account, no database, no export
button, because there is nothing proprietary to export from.

**[Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=YahyaShareef.gitpad)**

Or from the command line:

```bash
code --install-extension YahyaShareef.gitpad
```

## What it does today

- **Rich text editing.** Type `#` and get a heading, not a hash. Headings, tables, code blocks,
  checklists, callouts — a document to write in, a markdown file on disk.
- **A vault you pick.** Point GitPad at any folder. It only ever shows its own `.pad` files, so a
  vault inside a code project does not fill up with source.
- **Folders and trash.** Soft delete, and restore puts a note back in the folder it came from — even
  if that folder was deleted too.
- **Ranked full-text search.** Title matches beat body matches.
- **Themes for free.** Every colour resolves from VS Code's own variables, so light, dark,
  high-contrast and third-party themes all work.

## What it does not do yet

- **Git sync.** It is the next phase and the reason for the name: clone or create a private repo,
  auto-commit shortly after you stop typing, and conflict handling that never discards content.
- **Wikilinks (`[[note]]`).** Built and tested, but disabled — renames and deletes have cases still
  worth getting right before it ships.
- **Image uploads.** Images are external URLs only.
- **Boards and flowcharts.** Phase 3.

Version 0.1.0 is the local half, and deliberately honest about being early.

## Getting started

1. Install, then open the **GitPad** view in the activity bar.
2. **Create a vault**, or open a folder you already keep notes in.
3. **New note.** The filename is the title — there is no separate title field to drift out of sync
   with it.

Notes are `.pad` files containing plain markdown. The custom extension exists so GitPad never claims
ownership of anyone else's `.md` files; the contents are ordinary markdown either way.

## Contributing

Issues and pull requests are welcome. Two documents are worth reading first:

- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — the design, and the reasoning behind
  each non-obvious choice.
- [docs/PROGRESS.md](docs/PROGRESS.md) — what is actually built, and what is still open.

### Development

```bash
npm install
npm run compile          # build extension + webviews
npm run watch            # rebuild on save
npm run typecheck        # esbuild does not typecheck; this does
npm run lint             # includes the architectural boundary rule
npm test                 # unit tests — milliseconds, no editor
npm run test:integration # boots a real VS Code — seconds
npm run package          # build the .vsix
```

Press `F5` to launch the Extension Development Host.

## Licence

GitPad is MIT licensed and free permanently — not free-tier. See [LICENSE](LICENSE).

That is a design constraint, not just a licence: dependencies whose features sit behind a paid plan
are rejected during review, because a dependency that can start charging is a dependency that can
break the promise.

### Third-party

Icons are [Codicons](https://github.com/microsoft/vscode-codicons) by Microsoft, licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
