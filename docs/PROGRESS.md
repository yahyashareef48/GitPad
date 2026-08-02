# GitPad — Progress Log

Running record of what's actually been built, with commit references. The plan
([IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)) says what we intend to do; this file says what
we did, and where the two diverged.

**Conventions**
- Newest entries at the top.
- One entry per meaningful chunk of work — not per commit. A chunk may span several commits; list
  them all.
- Fill in the commit SHA *after* committing. `—` means the work isn't committed yet.
- If reality diverged from the plan, say so in **Deviation** and update the plan in the same entry.
  A plan nobody corrects stops being worth reading.

---

## Milestone status

| Milestone | Scope | Status |
|---|---|---|
| **M0** | esbuild build, folder structure, interfaces/DI, logging, vitest + integration harness | **Done** |
| **M1** | Webview host + RPC; vault setup flow; sidebar tree, search box, recently opened, context menus; file CRUD | **Done** |
| **M2** | Custom editor with plain-text editing — proves the editor plumbing | **Done** |
| **M3** | Crepe editor, markdown pipeline, block audit, VS Code theming, round-trip corpus | **Done** — wikilinks moved to M4 |
| **M4** | Trash, full-text search, wikilinks + backlinks, settings page → **Phase 1 ships** | **Done** — wikilinks built but **disabled**; `.md` import/export dropped |
| **M5** | Auth, repo create/clone wizard, GitService, manual "Sync now" | Not started |
| **M6** | Scheduler, status bar, sync footer, offline/backoff | Not started |
| **M7** | MergeEngine, conflict policy, sync simulator → **Phase 2 ships** | Not started |
| **M8** | History compaction + re-clone recovery path | Not started |
| **M9** | Board type + structured merge | Not started |
| **M10** | Flowchart type, cross-type links → **Phase 3 ships** | Not started |

Status values: `Not started` · `In progress` · `Done` · `Blocked` · `Deferred`

---

## Open questions carried forward

Things decided on paper but not yet validated against reality. Resolve these in the entries below
as they're answered.

| # | Question | Resolves at | Outcome |
|---|---|---|---|
| 1 | Does the Ctrl+Z bridge (VS Code → RPC → ProseMirror history) feel correct? | M2 | **Answered: yes.** `CustomDocumentEditEvent` with both sides of each change captured works cleanly, confirmed by hand. Two details made it feel right rather than merely function: debouncing edits at 400 ms so one Ctrl+Z removes a burst of typing rather than a character, and restoring the caret after remote text is applied — without it, undo threw the cursor to the end of the note on every step. Still to re-verify against ProseMirror's own history in M3. |
| 2 | Which Crepe blocks survive a markdown round trip, and which get disabled? | M3 | **Answered: nothing is lost.** Headings, emphasis, links, images, ordered lists, quotes, fenced code and strikethrough survive byte-identical. Disabled: LaTeX (needs remark-math), AI (needs a service), TopBar (filename is the title), image upload (out of scope). Three cosmetic normalisations remain — see the log. |
| 3 | How much work is restyling Crepe onto VS Code theme variables, really? | M3 | **Answered: much less than budgeted, then more than expected.** Crepe's themes are only `--crepe-*` custom properties over structural CSS, so the mapping itself was an hour. Getting it RIGHT took four rounds, because `--crepe-color-outline` names a border but colours icons too — one bad mapping made every toolbar, table and block-handle glyph invisible. |
| 4 | Does `react-arborist` + hand-built context menus reach parity with a native tree? | M1 | **Answered: yes, at a cost.** Virtualisation, keyboard nav and drag-and-drop came free. Context menus, the search box, icons and empty states were all hand-built. Roughly a day of work that a native `TreeView` would have given away — bought the search box, which a native tree cannot host at all. |
| 5 | Does the `.vsix` stay lean once React + `react-arborist` + Crepe land? | M3 | **Answered: yes, just.** 2.8 MB raw, **1.13 MB packaged**. Bulk is Vue (Crepe uses it internally) and `@codemirror/language-data`. Loaded on demand, so no activation cost. Trimmable if it matters. |

## Deferred, deliberately

| Item | Why it waits |
|---|---|
| **`[[Wikilinks]]` — built, tested, and switched OFF** | Turned off 2026-08-02 behind `WIKILINKS_ENABLED` in `src/shared/features.ts`. Everything works: the index, backlinks panel, clickable chips, `[[` autocomplete with folder disambiguation, path-qualified targets, and link rewriting on rename. What is *not* settled is note identity at the edges — what a link means when two notes share a title, when its target is deleted, when a **folder** is renamed rather than a note, and how much of that a user should have to think about. A linking feature that is right most of the time is worse than none: a link you cannot trust is one you stop using. Re-enable by flipping one constant; nothing else is required. **Remaining before it ships:** decide folder-rename behaviour, decide what a link to a deleted note should do beyond "offer to create", and cover both with tests. |
| **`.md` import/export** | Dropped from M4 on request. Notes are already plain markdown in `.pad` files, so `ren *.pad *.md` is the whole import/export story until someone needs more. |
| **Sidebar visual polish** — spacing, icons, row density, empty states, header treatment | Raised 2026-08-01. The tree is correct but plain. Deliberately deferred until CRUD, search and context menus are in, so the design work happens once against the finished surface rather than being redone after each addition. Not forgotten; it is scheduled, not skipped. |

---

## Log

### 2026-08-02 — M4 complete: Phase 1 ships
**Commits:** `5bd1a0d`, `0df74a4`, `68596b9`, `ccd66d7`, `48bbda2`, `7c6ff77`, `8fb2317`, `e840fcb`, `3e7cb65`, `de94251`, `4c364c9`, `d742c38`
**Milestone:** M4 → **Done**

- **Trash panel** — restore, delete permanently, empty. `.trash/` mirrors the vault's folder
  structure, so the path records where an item came from without an index that could disagree with
  it.
- **Full-text search** — ranked, with excerpts, as a Quick Pick (Ctrl+Alt+F). The sidebar box stays
  instant and title-only.
- **Settings page** — vault summary, the settings, and the actions VS Code's settings UI cannot
  host. Stores nothing; reads and writes VS Code configuration.
- **Wikilinks** — complete and then **disabled**; see "Deferred, deliberately" above.

**Bugs worth remembering.**

1. *Restore put everything at the vault root.* I had rejected recording the original location on
   the grounds that it meant a sidecar index that could disagree with reality — but the location
   fits in the trash **path**, which has exactly the no-index property I wanted. The reasoning was
   right and the conclusion was wrong.
2. *A deleted folder drew as a note.* `TrashService` knew the difference throughout; `kind` simply
   was not carried in the message to the webview, so the UI had nothing to draw with. Mislabelled,
   not mishandled.
3. *`path.extname('Q1.Reviews')` is `.Reviews`.* Splitting filenames unconditionally would have
   stored that folder as `Q1 (stamp).Reviews` and restored it under a different name — quiet, and
   only noticeable much later.
4. *Link updates ran after the rename.* The backlink graph resolves links to the files they point
   at, so once the file had moved nothing resolved to the old path and the answer was always zero.
   The affected set has to be captured first; the API is now two steps so it cannot be got wrong.

**What let (2) and (3) hide:** `InMemoryFileSystem` could not rename directories — it silently did
nothing. Every folder-deletion test passed while exercising nothing at all. Green tests, zero
coverage. The fake now moves subtrees like `vscode.workspace.fs.rename` does, and the trash round
trip is additionally verified against real files, because restoring wrong loses someone's note.

**Deviations:**
1. `[[Wikilinks]]` built but disabled — recorded above rather than deleted.
2. `.md` import/export dropped on request.
3. Tree ordering still falls back to alphabetical rather than `created`. The search index now reads
   frontmatter, so the data is available; wiring it up was not done.

**Tests:** 168 unit, 37 integration.

### 2026-08-02 — M3 complete: the rich editor
**Commits:** `bc687d4`, `4b76ef1`, `1e185be`, `ba00226`, `802cb1f`, `fda8f42`, `d7e3e8f`, `a841d6c`, `dfa8da9`, `22c8a5b`
**Milestone:** M3 → **Done**

- **Crepe** replaces the textarea: slash menu, block handles, drag-to-reorder, selection toolbar,
  tables, checkboxes, code blocks with highlighting.
- **Theming** maps Crepe's `--crepe-*` variables onto `--vscode-*`, so it follows the user's theme.
- **Note header** — file icon, editable title (renames the file), created/updated timestamps.
- **Product icon** for `.pad` in the sidebar, tab and breadcrumb.
- **Round-trip corpus** driving real Milkdown in jsdom — the guard plan 2.4 asks for.
- **Pinned serializer options**, so saving does not rewrite what the user wrote.

**The bug worth remembering.** Frontmatter was being rendered as document content — `---` followed
by text is a *setext heading*, so Crepe correctly rendered our metadata as a giant title. Auto-save
then wrote that interpretation back, permanently destroying the frontmatter of every note opened
before the fix. The editor now only ever sees body text.

**Lesson repeated a third time:** four visual bugs came from guessing at Crepe's class names and
CSS variables instead of reading its stylesheets. Reading them first fixed all of it in one change.
When integrating a component library, read its CSS before overriding it.

**Deviations:**
1. `[[wikilinks]]` moved to M4, where the link index and backlinks live. Wikilinks without an index
   are just text; the index without wikilinks has little to point at.
2. Image sizing CSS was written and then **backed out** — overrides fighting Crepe's stylesheet are
   maintenance debt. Images overflow until uploads are designed properly.
3. Crepe serializes a resized image's aspect ratio into the **alt text** (`![1.50](url)`),
   replacing the accessibility description with a number. Must be decided before image work resumes.

**Tests:** 110 unit, 33 integration.

### 2026-08-01 — M2 complete: the custom editor
**Commits:** `b02f440`, `f0a7707`, `093ffa1`
**Milestone:** M2 → **Done**

`.pad` files open in GitPad's own editor. `CustomEditorProvider` with a custom document, so this
code owns content, dirty state and the undo stack — the arrangement chosen in §1.4 specifically so
a rich editor's own history would not fight VS Code's.

- **The undo bridge works** (open question 1). Verified by hand.
- **Auto-save**, because VS Code's `files.autoSave` does not apply to custom editors. Default on:
  nobody expects to save a note, and Phase 2's sync waits for files to be written before committing.
- **External change reload** — a clean document reloads; a dirty one raises a conflict rather than
  discarding unsaved work. Our own saves are recognised by content comparison, not timestamps.
- The editing surface is a **plain textarea**, deliberately. Milkdown lands in M3 on plumbing
  already known to be sound.

**Bug worth remembering.** `backupCustomDocument` returns `destination.toString()`, so `backupId`
comes back as a URI string — `file:///c%3A/…`. Passing it to a path-based read resolved it as
`C:\file:\c%3A\…` and threw ENOENT, which made any note with a recorded backup **permanently
unopenable**. Fixed by parsing it as a URI, plus falling back to the file on disk when a backup is
stale, so a leftover id can never brick a note.

**The pattern, now four for four.** Every bug this session that reached the user was invisible to
unit tests and obvious to an integration test: a URI string looks like any other string in
`InMemoryFileSystem`. `platform/` and `ui/` code that touches real files or real VS Code state needs
integration coverage, not just a fake.

**Tests:** 95 unit, 29 integration.

### 2026-08-01 — M1 complete: CRUD, icons, search, recents, drag-and-drop
**Commits:** `802912b`, `18ca869`, `94d1ecd`, `1b36dc7`, `f0952a8`, `c6473e4`, `7fe1fe0`
**Milestone:** M1 → **Done**

- **Note CRUD** — create, rename, duplicate, move to trash, with `created`/`updated` frontmatter.
  Delete has no confirmation: it is reversible, and the notification carries the undo.
- **Codicons** — VS Code's own icon font replaced hand-picked Unicode glyphs. First dependency
  requiring attribution (CC BY 4.0); credited in the README and logged against §5.1.
- **Search box** — local title filtering, the feature that justified the webview sidebar.
- **Recently opened** — `globalState`, device-local, never synced.
- **Drag-and-drop** — reorder within a folder and move between folders, persisted to
  `.gitpad-order`.
- **Settings button** — VS Code's settings filtered to the extension, standing in until M4.

**Two bugs worth remembering**, both the same shape as earlier ones:

1. *Asked for the vault on every reload.* `VaultController.state` returned `no-vault` while restore
   was still running, conflating "no vault" with "not checked yet" — the identical mistake to the
   webview's `undefined` vs `no-vault`, made one layer down. Fixed with an explicit `loading` state.
2. *`filterTree` in `core/`* pulled `node:path` into the webview bundle and broke its typecheck. The
   two tsconfigs caught exactly the environment mixing they exist to prevent; the file belongs in
   `shared/`.

**Deviations:**
1. `.pad` files still open in VS Code's plain text editor — the custom editor is M2. Useful in the
   meantime: it demonstrates notes are ordinary markdown.
2. Tree ordering falls back to alphabetical rather than `created`, because reading frontmatter for
   every note on every scan is work the search index should do once. Revisit at M4.

**Tests:** 87 unit, 18 integration.

### 2026-08-01 — M1: vault setup, tree, and a rendering bug worth remembering
**Commits:** `bd02f28`, `ce02c90`, `8f6a382`, `5614b30`, `f39d88c`, `2df3185`, `73a02eb`
**Milestone:** M1 (in progress)

- **Vault core** — `VaultLayout`, `VaultConfig`, `VaultService`, and the foreign-repo guard.
  `detectVaultCandidate` walks ancestors, treats `.git` as present whether directory or file
  (worktrees use a file), and still flags a vault nested inside a foreign repo.
- **Setup flow + welcome screen** — React arrives ahead of the tree so the welcome screen isn't
  written twice. Folder picker deliberately has no `defaultUri`.
- **Tree** — visibility filter, advisory `.gitpad-order`, `react-arborist`, `FileSystemWatcher`.
- **Vault header** — the vault was chosen once and then invisible, with no way to switch.

**The bug worth remembering.** The tree rendered nothing whenever notes existed. `NoteTree`
returned early for the empty case, unmounting the element holding the measuring ref; both sizing
effects run once on mount, found `ref.current === null`, and never attached a `ResizeObserver`.
When notes arrived the element mounted but the effects had `[]` deps and never re-ran, so the tree
stayed 0×0 — and a virtualised tree at zero height draws nothing. No error, no clue, and "No notes
yet" never appeared because `nodes` was populated the whole time.

**What let it hide:** every unit test ran against `InMemoryFileSystem`, so `VsCodeFileSystem` had
never executed in a test. All 54 passed while the sidebar showed nothing. Integration tests now
exercise the real adapter and real `VaultTree` against a temp directory (10 integration tests, up
from 2). They passed, which is what located the fault in the webview.

**Lesson recorded:** a port with no integration test is a port that has never run. Every adapter in
`platform/` needs at least one test against the real thing.

**Deviation:** none from the plan; `.gitpad-order` and visibility landed as designed.

### 2026-08-01 — M0 complete: ports, boundary rule, test harnesses
**Commits:** `a472b99`, `25d2cff`, `60bac77`, `c991a9a`, `e7ac2c8`
**Milestone:** M0 → **Done**

- **Ports + adapters** — `FileSystem`, `Clock`, `Logger` in `core/ports/`, implemented in
  `platform/`. `FileSystem` wraps `vscode.workspace.fs`, not `node:fs`, so a vault on Remote SSH,
  WSL or a Codespace works unchanged. `stat()` returns `undefined` for a missing path rather than
  throwing, because "does this exist?" is a routine question here.
- **ESLint boundary rule** — `src/core` and `src/types` cannot import `vscode`, `platform/`, `ui/`
  or `sync/`. Both messages name the fix and the plan section. Verified with a probe file: it
  produces exactly the two expected errors.
- **vitest harness** — proven with real logic rather than a placeholder: `core/naming/filename.ts`
  (title → filename stem), 18 tests covering Windows' forbidden characters, reserved DOS device
  names, trailing dot/space stripping, length capping, and case-insensitive uniquification.
- **Integration harness** — `@vscode/test-cli`, 2 tests asserting the extension activates in a real
  VS Code and contributes the activity bar container and sidebar view.
- Activity bar icon viewBox cropped to the mark's bounds (`e7ac2c8`) — it inherited `icon.svg`'s
  untrimmed canvas and read as ~25% too small next to native glyphs.

**Verified:** `typecheck`, `lint`, `test` (18 passing), `test:integration` (2 passing), and the
sidebar confirmed rendering in the Extension Development Host by the user.

**Deviations:**
1. `core/naming/filename.ts` is M1 work per the plan, pulled forward to give the vitest harness a
   real subject. A harness proven by a placeholder test proves nothing.
2. Root `tsconfig` moved to `Node16` module resolution so tsc can read the `exports` maps vitest
   publishes types behind. No effect on esbuild, which reads its own config.

**Known and accepted:** `npm audit` reports 4 advisories reached transitively through mocha, a
devDependency of `@vscode/test-cli`. Never shipped in the `.vsix`; the offered fix is a downgrade.

### 2026-08-01 — M0: build pipeline + sidebar vertical slice
**Commits:** `4b7f69f`, `3d59f71`
**Milestone:** M0 (in progress)
**Branch:** `feat/m0-build-pipeline`

Replaced the `tsc`-only build with esbuild across two targets, then proved it end to end with the
thinnest possible sidebar.

- `esbuild.mjs` — extension (CJS/node, `vscode` external) and webview (ESM/browser, code-split).
- Two tsconfigs enforcing the environment split: `types: ["node"]` on one side, `types: []` + DOM
  on the other, meeting only at `src/shared/`. Environment mistakes are now build errors.
- `npm run typecheck` is a separate gate, since esbuild doesn't typecheck.
- Output `out/` → `dist/`; launch.json, tasks.json, `.vscodeignore`, `.gitignore` updated.
- Activity bar container + `gitpad.sidebar` webview view; CSP'd HTML shell with per-load nonce;
  typed `ready` → `init` round trip between host and webview.
- `media/activity-bar.svg` split from `icon.png` — VS Code themes activity bar icons itself, so
  that mark carries no colour of its own.

**Verified:** `npm run compile`, `npm run typecheck`, and `vsce package` all pass. Found and fixed
`vsce` shipping the stale `out/` directory.

**Not verified:** the sidebar actually rendering. That needs F5 and a human looking at it.

**Deviation:** none.

### 2026-08-01 — Implementation plan complete
**Commits:** `ae4226d`
**Milestone:** pre-M0

Full implementation plan written and settled across Phases 1–3. Key decisions, with reasoning
recorded in the plan:

- `.pad` files containing plain GFM markdown; `.padboard` / `.padflow` as deterministic JSON later
- `CustomEditorProvider` (custom document) for all types, not `CustomTextEditorProvider`
- Milkdown + Crepe as the editor; Lexical, CodeMirror 6, BlockNote, Tiptap evaluated and rejected
- `isomorphic-git` + `@octokit/rest`; GitHub first behind a `RemoteProvider` interface
- Sidebar is a webview (`react-arborist`), not a native tree
- Title is the filename; ordering by `created` with per-folder `.gitpad-order`
- Free-forever licensing constraint — no dependency with a paid tier gating features we need
- File uploads and real-time collaboration deliberately out of scope

**Deviation:** none — nothing built yet.

### 2026-07-30 — Repo scaffold
**Commits:** `b7ab2d7`, `f25ef7e`
**Milestone:** pre-M0

Bare VS Code extension scaffold: empty `activate()`, `tsc`-only build, empty `contributes`, icon
and publisher metadata. No features.
