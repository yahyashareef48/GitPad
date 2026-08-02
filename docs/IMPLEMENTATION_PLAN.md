# GitPad — Implementation Plan

> Status: planning document. No code written yet. Current repo is a bare extension scaffold
> (`src/extension.ts` with an empty `activate()`, `tsc`-only build, empty `contributes`).

---

## 0. Product shape

GitPad is a **personal knowledge workspace inside VS Code**, backed by a folder of plain files
("the vault"), optionally synced to a private Git repo.

Four properties drive every decision below:

1. **Files are the source of truth.** Not a database, not extension state. Every document is a
   real file on disk that survives GitPad being uninstalled. This is what makes Git sync possible
   at all, and what makes the data trustworthy.
2. **The user picks where the vault lives.** New folder, cloned repo, or an existing folder of
   notes — their choice, made on first run.
3. **Document types are plugins.** Notes are the first type. Boards, flowcharts, and anything
   else register into the same registry and get the tree, search, sync, and conflict handling
   for free.
4. **Free forever, no paid dependencies.** GitPad is open source and must stay usable at zero
   cost. See §5.1 — this rules out some otherwise-attractive libraries.

---

## 1. Architecture

### 1.1 Layers

```
┌─────────────────────────────────────────────────────────────┐
│ Webview layer (browser context, bundled separately)         │
│   editor-host shell  ·  note editor  ·  board  ·  flowchart │
└────────────────────────── RPC ──────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ UI layer (extension host)                                   │
│   VaultTreeProvider · CustomEditorProviders · Commands       │
│   StatusBar · QuickOpen · Notifications                      │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Domain layer                                                │
│   DocumentTypeRegistry · VaultService · LinkIndex ·          │
│   SearchIndex · TrashService                                 │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Sync layer (Phase 2, entirely optional & lazily loaded)     │
│   SyncEngine · SyncScheduler · GitService · MergeEngine ·    │
│   RemoteProvider (GitHub → GitLab/Gitea) · AuthService       │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Platform adapters                                           │
│   FileSystem (vscode.workspace.fs) · Clock · Logger ·        │
│   Secrets · Config                                           │
└─────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows only point downward. The domain layer never imports `vscode` directly
— it takes a `FileSystem` interface. That keeps merge logic, markdown round-tripping, and the link
index unit-testable in plain Node/vitest without an extension host, which is where most of the
real bugs will be.

### 1.2 The spine: `DocumentTypeRegistry`

Every capability that varies per document type goes behind one interface. Everything else is
type-agnostic.

```ts
interface DocumentType<TModel = unknown> {
  id: string;                    // "note" | "board" | "flowchart"
  extensions: string[];          // [".pad"] | [".padboard"]
  displayName: string;
  icon: ThemeIcon;

  // Serialization — the only code that knows the on-disk format
  parse(raw: Uint8Array, ctx: ParseContext): TModel;
  serialize(model: TModel): Uint8Array;

  // Editor — which webview module renders it
  editorEntry: string;           // bundle name, e.g. "note-editor"

  // Sync (Phase 2) — how two divergent versions become one
  merge?: MergeStrategy<TModel>;

  // Domain integration
  extractText?(model: TModel): string;      // feeds the search index
  extractLinks?(model: TModel): DocLink[];  // feeds the link index
  createEmpty(title: string): TModel;
}
```

Adding "kanban board" in Phase 3 = one file implementing this interface + one webview entry. No
changes to the tree, sync scheduler, search, commands, or conflict UI. That is the whole point.

### 1.3 File formats

| Type | Extension | Content on disk | Phase |
|---|---|---|---|
| Note | `.pad` | GitHub-flavored **markdown**, plus optional YAML frontmatter | 1 |
| Board | `.padboard` | deterministic pretty-printed JSON | 3 |
| Flowchart | `.padflow` | deterministic pretty-printed JSON | 3 |

**Custom extensions, text content.** The extension gives unambiguous type routing, our own icon,
and complete freedom from other extensions' file associations — GitPad never touches a `.md` file
it wasn't asked to.

The *content* stays plain text in every case, and for notes it stays plain markdown. Two reasons:

- **Escape hatch.** If GitPad dies or the user moves on, `ren *.pad *.md` and every note opens in
  Obsidian, GitHub, or Notepad. A notes app that can trap your notes is not trustworthy.
- **Git.** Text content means readable diffs and workable 3-way merges. An opaque format would
  turn every concurrent edit into a whole-file conflict, throwing away everything Phase 2 builds.

Accepted cost: github.com won't pretty-render `.pad` in its web UI — you'd see raw markdown text,
readable but unstyled. `.gitattributes` in the vault marks `*.pad` as `linguist-language=Markdown`
to recover syntax highlighting where GitHub honors it.

`.md` files are still handled as **import/export**, not as a native type: "Import markdown folder"
and "Export vault as markdown" commands. Two-way, lossless, one command each.

### 1.4 Editor hosting — the key VS Code API decision

Two options exist, and picking wrong here costs a rewrite:

| | `CustomTextEditorProvider` | `CustomEditorProvider` (custom document) |
|---|---|---|
| Backing model | a `TextDocument` | whatever we want |
| Undo/redo | VS Code's text undo stack | we fire `CustomDocumentEditEvent`, VS Code calls our undo/redo |
| Save / dirty / hot-exit | free | we implement `save`, `backup`, `revert` |
| Non-text types (Phase 3) | not usable | works |

**Decision: `CustomEditorProvider` with a custom document, for all types including notes.**

A live-rendering editor produces a continuous stream of small edits, and it already has its own
undo history (ProseMirror's). Routing edits through a `TextDocument` means two undo stacks fighting
over Ctrl+Z, plus either whole-range replacement or per-keystroke diffing. With
`CustomEditorProvider` we forward VS Code's Ctrl+Z into the editor's own history and it just works.
Phase 3 types require this API regardless — so one editor host abstraction serves everything
instead of two.

Cost we accept: `.pad` files aren't live-synced with a side-by-side plain text editor. Mitigated by
reloading the webview on external file change, which Git sync needs anyway.

Because we own `.pad` outright, we register as the **default** editor for it — no risk of hijacking
anyone else's files, and no "Reopen With" friction.

### 1.5 Webview ↔ extension protocol

One typed RPC module shared by both sides (`src/shared/protocol.ts`), imported by extension and
webview code alike. Request/response with correlation IDs plus one-way notifications. **Two
channels** — the editor webview and the sidebar webview (§2.2) — sharing one message layer:

```
editor → host:   ready, edit(patch), requestSave, openLink(target), searchDocs(query)
host → editor:   init(model, theme, capabilities), applyExternal(model),
                 undo, redo, revert

sidebar → host:  ready, openDoc(uri), createDoc(parent), createFolder(parent),
                 rename(uri, title), move(uri, parent, index), trash(uri),
                 restore(uri), filter(query), syncNow, reload
host → sidebar:  tree(nodes), recentlyOpened(list), backlinks(list),
                 trash(list), syncStatus(state), activeDoc(uri)
```

Rules: no `any` across the boundary; every message is a discriminated union member. Webview state
persists through `getState`/`setState` so tab restore doesn't lose scroll/cursor.
`retainContextWhenHidden` stays **off** (memory hog with many tabs) — state restore covers it.

**Security:** strict CSP with a per-load nonce, `localResourceRoots` limited to the bundle dir, and
**`img-src https:` as the single remote exception** (§2.5) — scripts, styles, fonts, and frames stay
local-only, and `http:` is never allowed. No user content ever reaches `innerHTML` unsanitized.

### 1.6 On-disk vault layout

```
<user-chosen folder>/           ← the vault (a git repo in Phase 2)
├── .gitpad/
│   ├── config.json             ← vault settings, schema version (committed)
│   ├── sync-state.json         ← last synced commit, device id (gitignored)
│   └── cache/                  ← search + link index (gitignored)
├── .gitignore                  ← created by us
├── .gitattributes              ← diff/merge/linguist hints per file type
├── .trash/                     ← soft deletes, pruned after N days
├── assets/                     ← reserved; unused until uploads land (§2.5)
└── <user folders + .pad files>
```

Everything user-facing is a normal file in a normal folder. No hidden index that can desync from
reality — the filesystem *is* the index, and `.gitpad/cache/` is a disposable derivative that can
always be rebuilt by a full scan.

### 1.7 Build tooling change (needed before Phase 1 code)

Current `tsc`-only build can't produce webview bundles. Switch to **esbuild**, two targets:

- `extension` → CJS, platform `node`, `vscode` external, output `dist/extension.js`
- `webview/*` → ESM, platform `browser`, one entry per document type, shared chunks split out,
  CSS bundled, output `dist/webview/`

Keep `tsc --noEmit` as a separate typecheck script. Update `.vscodeignore` to ship `dist/` only.

Note: `@vscode/webview-ui-toolkit` is deprecated — do **not** adopt it. Style with VS Code's CSS
custom properties (`--vscode-editor-background`, etc.) so light, dark, and high-contrast theming
is automatic.

### 1.8 Repository layout

Structure exists to keep the **blast radius of a future change small**. Each concern lives in one
place, and the boundaries between them are enforced rather than agreed.

```
src/
├─ extension.ts              activation only: wire things together, nothing else
│
├─ core/                     ← domain. NEVER imports vscode.
│  ├─ registry/              DocumentType.ts, DocumentTypeRegistry.ts
│  ├─ vault/                 VaultService, VaultLayout, TrashService
│  ├─ naming/                title ↔ filename: sanitize, uniquify, debounce rules (§2.6)
│  ├─ ordering/              .gitpad-order read/write/merge (§2.7)
│  ├─ index/                 LinkIndex, SearchIndex
│  └─ ports/                 FileSystem, Clock, Logger — interfaces the domain needs
│
├─ types/                    ← one folder per document type, self-contained
│  └─ note/                  NoteType.ts + markdown/{parse,serialize,frontmatter}.ts
│
├─ platform/                 ← vscode adapters implementing core/ports
│
├─ ui/                       ← extension-host side
│  ├─ sidebar/  editor/  settings/  commands/
│  └─ webview/               html, CSP, nonce, URI rewriting
│
├─ sync/                     ← Phase 2. Absent in Phase 1, so nothing can leak in.
│
└─ shared/protocol.ts        ← the ONLY file both extension and webview import

webview/                     ← browser context, own tsconfig
├─ sidebar/  editor/  settings/
└─ shared/rpc.ts

test/
├─ unit/                     vitest — core/ and types/ only, no extension host
├─ integration/              @vscode/test-cli
└─ fixtures/roundtrip/
```

Three properties this is built for:

- **`core/` cannot import `vscode` — enforced by an ESLint boundary rule, not by convention.**
  A rule people have to remember is a rule that gets broken in month three; a rule that fails the
  build doesn't. It's also what keeps merge logic and the markdown pipeline testable in plain
  vitest without an extension host (§1.1).
- **`types/<name>/` is self-contained.** Adding the board in Phase 3 is a new sibling folder — no
  edits to tree, sync, search, or conflict code. The registry (§1.2) doing its job.
- **`sync/` does not exist in Phase 1.** Not stubbed, not empty — absent. Nothing can accidentally
  depend on it before it's designed.

#### Code style
- **Small, separated units.** One concern per file. A change should touch one folder, not five.
- **Inline comments that explain *why*, not *what*.** The plan holds the long reasoning; comments
  hold the short version at the point it matters — the non-obvious constraint, the reason a naive
  version would be wrong. Don't narrate what the line plainly does.
- **Clean and simple over clever.** Predictable beats condensed; this codebase will be read far more
  than it's written.

---

## 2. Phase 1 — Vault, tree, and the live note editor

**Goal:** a user installs GitPad, points it at a folder, and writes in a Notion-style block editor
— slash menu, drag-to-reorder, live formatting — that saves plain markdown in `.pad` files. Zero
Git involvement.

### 2.1 Vault setup — user chooses

First run shows a welcome view in the sidebar with three paths:

1. **Create a new vault** — folder picker, starts empty with a welcome note.
2. **Open an existing folder** — point at notes they already have; offers to convert `.md` → `.pad`.
   If declined, show a one-time "37 markdown files are hidden — convert them?" hint rather than an
   empty panel that looks broken.
3. **Clone an existing repo** — **shown but disabled in Phase 1**, with a tooltip saying it arrives
   with sync. Cloning is git, and git is Phase 2. Nothing is lost by waiting: a vault created in
   Phase 1 connects to a repo later without moving a single file — enabling sync just runs `git init`
   in the folder that already exists.

Stored as `gitpad.vault.path`. The folder picker must **not** default to the currently-open
workspace — a personal note landing inside a client's repo, then getting auto-committed there
every five seconds in Phase 2, is the worst failure mode this product has.

#### Guarding against adopting someone else's repo

Three cases, and they are not equivalent:

| The chosen folder is… | Handling |
|---|---|
| A plain folder, no git anywhere above it | Fine. `git init` happens later, if sync is enabled. |
| Already a GitPad vault (`.gitpad/config.json` at the repo root) | Fine — this is the second-device path. Adopt it. |
| **A git repo that is something else** (a code project) | **Warn hard.** See below. |

**The check must walk up ancestors, not just test the chosen folder.** Picking
`~/projects/myapp/notes` — no `.git` of its own, but sitting inside one — is the common and sneaky
version of this mistake.

**Why the third case is dangerous.** Pointed at a code project, GitPad would auto-commit the user's
uncommitted source every five seconds onto whatever branch is checked out; force-push during history
compaction (§3.8), destroying their project history; stamp the co-author trailer (§3.7) on their
real commits; fight them over private-repo enforcement (§3.1); and scatter conflict copies (§3.6)
through their source tree. Meanwhile the sidebar shows **nothing**, because everything that isn't a
document type is filtered out (§2.2) — so it looks broken while quietly consuming their repo.

**Warn, don't block.** Someone may genuinely want notes inside a repo with sync off; refusing
outright means guessing at their situation. Explain what would happen in plain language, then offer
three options with the safe one preselected:

1. **Choose a different folder** (recommended)
2. **Use it with sync off** — GitPad manages notes as files; their git is never touched
3. **Use it with sync on** — typed confirmation, not a single click

**The invariant that makes the bad path unreachable by accident:**

> Sync auto-enables only for a repo **GitPad created**, or one whose root contains
> `.gitpad/config.json`. Adopting any other repo for sync requires explicit consent, recorded as
> `adoptedForeignRepo: true` in the vault config.

**Re-check at sync-enable time, not only at vault-pick time.** A vault created today with sync off
may have sync turned on months later, long after the user has forgotten what folder they chose.

Scaffold `.gitpad/config.json` with `{ schemaVersion: 1 }` — versioned from day one so future
migrations aren't archaeology. `VaultService` takes a vault root as a parameter rather than reading
a global, so multi-vault support later is a UI change, not a refactor. Ship single-vault UI.

### 2.2 The sidebar

**GitPad gets its own Activity Bar container** — its own icon in the far-left strip, not a view
inside the Explorer. Two reasons: the vault isn't the workspace, so it shouldn't live in the
workspace's file tree; and its own container means notes stay visible no matter which project is
open.

Clicking a note opens it as an ordinary editor tab.

#### The sidebar is a webview, not a native tree

**Decision: `WebviewViewProvider`, not `TreeDataProvider`.** A native tree can't host a search box,
can't render a "Recently opened" section with its own styling, and can't be made to look like
Notion. The freedom is worth the cost — but the cost is real and is scoped here rather than
discovered later.

**What VS Code gave for free and we now build ourselves:**

| Lost | Recovered by |
|---|---|
| Keyboard navigation (arrows, home/end, type-to-jump) | `react-arborist` |
| Drag-and-drop with drop indicators | `react-arborist` (and we needed custom ordering anyway — §2.7) |
| Virtual scrolling at thousands of notes | `react-arborist` (virtualized by default) |
| Inline rename | `react-arborist` |
| Right-click context menus | **hand-built** — VS Code menu contributions don't reach inside a webview |
| Screen-reader support | **hand-built** ARIA tree roles; partially covered by `react-arborist` |
| Automatic theming | §5.5 CSS variable mapping |

`react-arborist` (MIT) covers most of it. The genuinely new work is context menus and
accessibility.

Two consequences: **React moves into Phase 1** (it was a Phase 3 webview dependency), and the
sidebar bundle now loads at activation, which eats into the <100 ms budget in §5.6 — so it is
code-split and kept small.

#### Layout

```
┌ GITPAD ───────────────────────── [＋] [📁] [⚙] ┐
│  🔍 Search notes…                               │
│                                                 │
│  RECENTLY OPENED                                │
│     📄 Standup notes                            │
│     📄 Reading list                             │
│                                                 │
│  NOTES                                          │
│   ▾ 📁 Work                                     │
│        📄 Standup notes                         │
│        📄 Untitled 2                            │
│     📄 Reading list                             │
│                                                 │
│  ▸ BACKLINKS                                    │
│  ▸ TRASH  (3)                                   │
├─────────────────────────────────────────────────┤
│  ✓ Synced just now              [⟳ Sync now]    │
└─────────────────────────────────────────────────┘
```

- **Search box** — inline, filters the tree live. The reason for going webview in the first place.
- **Recently opened** — most recent first, capped (default 5). Toggle:
  `gitpad.sidebar.showRecentlyOpened`. Stored in `.gitpad/cache/`, **not synced** — "recent on this
  machine" is device-specific and syncing it would show your laptop's history on your desktop.
- **Notes** — folders and files, ordered per §2.7.
- **Backlinks** — what links to the open note. Collapsed by default. Kept here rather than at the
  bottom of the note (Obsidian's placement) so it doesn't compete with the writing surface.
- **Trash** — §2.8, count badge.
- **Sync footer** — §3.4.

Header actions are **icons**: New Note · New Folder · Settings.

Clicking a note posts a message to the extension host, which opens it via
`vscode.openWith` — an ordinary editor tab, unchanged.

#### Sidebar webview lifecycle
Sidebar webviews are disposed when hidden, so all state (scroll, expanded folders, search text)
persists through `getState`/`setState` and is restored on reveal. The tree itself is always rebuilt
from the filesystem, never from cached state — the filesystem stays the source of truth (§1.6).

#### What the tree shows
| | |
|---|---|
| **Show** | folders, `.pad` files (later `.padboard`, `.padflow`) |
| **Hide** | `.git/`, `.gitignore`, `.gitattributes`, `.gitpad/`, `.gitpad-order`, `assets/`, `.trash/`, and every other file type |

Folders are hidden by a **fixed name list**, not by "does it contain anything visible" — otherwise a
folder you just created would flicker out of existence until you put something in it. Predictable
beats clever.

**Hiding is a view filter, not an exclusion from sync.** Drop a PDF into the vault via Windows
Explorer and GitPad won't show it, but git still commits and backs it up. The alternative — only
syncing what we display — risks silently failing to protect a file the user deliberately put there.
Surface the count somewhere unobtrusive so it's never a mystery.

#### Mechanics
- Tree data comes from `vscode.workspace.fs` in the extension host, pushed to the webview over RPC
  (§1.5) and refreshed by a `FileSystemWatcher` on the vault.
- Ordered by `created` ascending — oldest top, newest bottom — with manual drag-to-rearrange
  persisted per folder (§2.7). Icons from the registry per extension.
- Context menu (hand-built): New Note, New Folder, Rename, Duplicate, Move to Trash, Reveal in OS,
  Copy Link.
- Deletes go to `.trash/` with a timestamp suffix, never `unlink`. People lose notes to stray
  keystrokes, and in Phase 2 a hard delete propagates to every device within five seconds.

### 2.3 Markdown pipeline

`.pad` content is markdown, so every save round-trips parse → model → serialize. Lossy
round-tripping silently corrupts notes. Guard it:

- **`unified` / `remark`** — `remark-parse`, `remark-gfm` (tables, task lists, strikethrough,
  autolinks), `remark-frontmatter`, `remark-stringify`. Frontmatter read with `gray-matter` for
  `title`, `created`, `updated`, `tags`.
- Serializer options pinned explicitly (bullet char, emphasis marker, fence style, no line
  wrapping) so unrelated notes don't churn on every save — this matters enormously once Git diffs
  arrive in Phase 2.
- **Golden-file round-trip suite from day one:** a corpus at `test/fixtures/roundtrip/*` asserted
  byte-identical through parse→serialize. Every bug found in the wild becomes a fixture. This
  suite is the best defence against the failure mode that would kill the product.
- Unknown frontmatter keys preserved verbatim (Obsidian/Foam compatibility).

### 2.4 The editor — Notion-style, under one hard rule

**Library: Milkdown + the Crepe preset** (`@milkdown/crepe`).

Crepe is Milkdown's batteries-included Notion-style editor. Out of the box it gives us the slash
menu (`/`), block handles with drag-to-reorder, a selection toolbar, image blocks, link tooltips,
code blocks with a language picker and syntax highlighting, tables, checkboxes, and placeholder
text. Its features are individually toggleable, so we take what fits and turn off what doesn't.

Using Crepe rather than assembling this ourselves is the difference between installing the Notion
feel and building it — the reason we're not on Lexical.

#### The hard rule

**Every block the editor can create must have a markdown representation.** Our storage format is
markdown; a block that can't serialize can't be saved. This is the gate every editor feature has
to pass, and it's the main thing to verify while wiring Crepe up.

| Crepe capability | Markdown form | Verdict |
|---|---|---|
| Headings, bold/italic/strike, lists, quotes, code, links, HR | CommonMark | ✅ keep |
| Tables, task list checkboxes, autolinks | GFM (`remark-gfm`) | ✅ keep |
| Image block | `![alt](https://…)` | ✅ keep, **URL entry only — uploader disabled** (§2.5) |
| LaTeX / math | `$…$`, `$$…$$` | ⚠️ needs `remark-math`; decide during M3, disable if it costs round-trip fidelity |
| Anything with no markdown form | — | ❌ disabled |

Crepe also ships its own CSS theme, which will not match VS Code out of the box. Restyling it onto
VS Code's theme variables is real work and is tracked in the UI/theming design (see §5.5).

#### Why Milkdown over the alternatives

| Candidate | Verdict |
|---|---|
| **Milkdown + Crepe** ✅ | ProseMirror-based, and its document model **is remark** — the same markdown pipeline we already need, so round-trip fidelity is structural rather than bolted on. Crepe ships the Notion feel as an install. MIT, no paid tier. |
| Lexical | Excellent engine, MIT, Meta-backed, and its published `LexicalTypeaheadMenuPlugin` can absolutely build a slash menu — the playground proves the capability. But the playground is demo source you copy and adapt, not a preset you install, and more importantly its model is its own node tree with markdown as a transformer layer we'd own and extend forever (tables, task lists, and frontmatter are not in the default transformer set). Wrong shape for markdown-as-storage, not a weaker editor. |
| CodeMirror 6 | Gives Obsidian-style live preview, not Notion — it's a text buffer, so there are no blocks to drag. Zero round-trip risk, though; keep as the fallback if Milkdown disappoints and we'd accept the simpler feel. |
| BlockNote | Notion-like and good at it, but markdown is an export format (lossy round trip). Core is MIT; `xl-*` packages carry a separate commercial license. |
| Tiptap | Notion-like extensions including the drag handle are **paid Pro**. Fails the free-forever constraint (§5.1). |

#### Build order inside Phase 1
1. Webview shell + RPC + document load/save with a plain textarea — proves the host layer alone.
2. Drop in Crepe with default features; wire `edit` → debounced serialize → `CustomDocumentEditEvent`.
3. Undo/redo bridge: VS Code Ctrl+Z → RPC → ProseMirror history. **Prototype this before building
   anything on top of it.**
4. Audit every Crepe block against the markdown rule above; disable what fails, add fixtures for
   what passes.
5. Restyle Crepe onto VS Code theme variables (§5.5).
6. Image block wired to URL entry only, uploader disabled, CSP relaxed to `img-src https:` (§2.5).
7. Internal links: `[[wikilink]]` support, plus a `/` slash-menu entry and autocomplete over vault
   note titles — our first custom Crepe block.

### 2.5 Images — external URLs only (uploads deferred)

**File upload is out of scope for Phase 1 and disabled in the editor.** Images are inserted by
pasting a URL; the editor fetches and renders them. Nothing is written to the vault.

Cutting this removes an entire subsystem from Phase 1 — local storage, content hashing,
downscaling, size limits, orphan collection, and the relative-path ↔ webview-URI translation that
every one of those depends on. None of it is needed to prove the editor works.

**What we do:**
- Configure Crepe's image block for URL entry only; **disable the uploader hook**
  (`@milkdown/plugin-upload` is not installed) so paste and drag-drop of a file is a no-op rather
  than a broken half-feature.
- Markdown stays standard: `![alt](https://…)`. Fully portable, no translation layer.
- **"Find broken links"** command covers dead image URLs alongside dead `[[wikilinks]]`.

**The one thing this introduces — CSP.** §1.5 locks the webview to local resources. Rendering
remote images requires relaxing it to allow `img-src https:`. That is a real trade: opening a note
makes the viewer's IP visible to whatever server hosts the image, which is the standard tracking
pixel mechanism. Email clients block remote images by default for exactly this reason.

Decision: allow `https:` images (blocking them makes the feature pointless), but keep it to
`https:` only — never `http:` — and add `gitpad.editor.loadRemoteImages` for users who'd rather
not. Nothing else in the CSP loosens; scripts, styles, and frames stay local-only.

**When uploads return (Phase 2.5 or later)**, the design is already worked out and worth keeping:
content-hash filenames sharded git-style (`assets/a3/f9c2.webp`) for free deduplication and
conflict-free sync, automatic downscaling via `OffscreenCanvas` before write, size limits, and
orphan collection into trash gated behind a successful sync. Recorded here so it isn't re-derived.

### 2.6 Titles and filenames

**The title is the filename.** It's rendered Notion-style at the top of the editor — large, editable
in place, no separate field. There is no `title` in frontmatter and no `# Heading` duplicating it;
the filename is the single source of truth, so nothing can drift out of sync. On `.md` export the
title is prepended as an `# H1`.

Four things this requires:

| Problem | Handling |
|---|---|
| Every keystroke would rename the file | Rename is **debounced** — on blur, or ~2 s idle. Typing a title otherwise generates hundreds of git renames. |
| Windows forbids `\ / : * ? " < > \|`, trailing dots/spaces, and reserved names (`CON`, `NUL`, `COM1`…) | Silently substituted in the filename. The displayed title keeps what you typed where possible; where it can't, the substitution is visible, not silent-and-wrong. |
| Two notes can't share a name in a folder | Append ` 2`, ` 3`, … |
| Very long titles | Filename capped (~200 chars) to stay clear of path limits |

**New notes are untitled.** On disk they are genuinely named `Untitled.pad`, `Untitled 2.pad`,
`Untitled 3.pad` — uniqueness is required, so the name cannot be identical across files. The
editor's greyed placeholder shows **the actual current filename**, not a generic "Untitled", so the
tree and the editor never disagree about what you're looking at. Typing replaces it.

### 2.7 Ordering and metadata

#### Filesystem timestamps are unusable
**Git does not store timestamps.** Clone a vault onto a second machine and every note reports as
created at checkout time, in arbitrary order. Any ordering derived from `mtime`/`birthtime` is
destroyed by the very sync feature the product is built around. Dates must be written down
explicitly.

#### Where each piece lives
| Metadata | Stored in | Why |
|---|---|---|
| `created`, `updated` | YAML frontmatter in the `.pad` file | Travels with the note, survives copying it anywhere, readable in any text editor |
| Manual order | `.gitpad-order` — one small file per folder | Putting order in frontmatter means dragging one note rewrites **every** note in the folder |
| Title | the filename (§2.6) | Single source of truth |

Frontmatter is metadata, not content: the editor never shows it as text, and unknown keys are
preserved verbatim on round trip (§2.3).

#### Default order
**Ascending by `created`** — oldest at the top, newest at the bottom, folders and files alike.
Manual drag-to-rearrange overrides it.

#### `.gitpad-order` is advisory, never authoritative
It lists filenames in the user's chosen sequence. The tree treats it as a hint:

- A file **not** in the list falls back to its `created` position.
- A listed file that no longer exists is ignored.
- Merging two devices' lists is a **union preserving relative order**, so it can never hard-conflict.

That means a file created, deleted, or moved outside GitPad — via Windows Explorer, or by git itself
during a merge — can't corrupt the view. The tree self-heals.

**Bonus:** this file doubles as the empty-folder marker git requires (git tracks files, not
folders), so a folder you create and haven't filled yet still survives a sync. One mechanism, two
problems.

### 2.8 Trash

- Deletes move to `.trash/` with a timestamp suffix. Never `unlink`.
- Collapsed **Trash** section at the bottom of the tree; right-click to restore or delete
  permanently, plus "Empty trash".
- **Trash syncs.** Delete a note on your laptop and restore it from your desktop. Excluding it from
  sync would make a delete on one machine look permanent everywhere else. Notes are tiny; the cost
  is nothing.
- Auto-purge after `gitpad.trash.retentionDays` (default 30).
- Caveat to surface in the UI: emptying the trash does **not** shrink the git repo — see §3.8.

### 2.9 Search & links
- `LinkIndex`: forward + backlink map, built by a full vault scan on activation, updated
  incrementally by the file watcher. Rename updates inbound links (behind a confirm prompt).
- Search: full-text via a small in-memory index (`flexsearch` or `minisearch`) over
  `extractText()`. Three consumers, one index:
  - the **sidebar search box** (§2.2) — filters the tree live as you type;
  - a **Quick Pick** ("GitPad: Search Notes") for keyboard-driven jump-to-note;
  - the editor's `[[wikilink]]` autocomplete.
- Index persisted to `.gitpad/cache/` with a content-hash validity check; rebuilt if stale.

### 2.10 Phase 1 exit criteria
- Create/rename/move/delete notes and folders from the tree, reflected on disk.
- Notion-style editing of `.pad`: slash menu, drag-to-reorder, selection toolbar, headings, lists,
  checkboxes, tables, code, images, links.
- Ctrl+S / dirty indicator / Ctrl+Z all behave like a native editor.
- Editor styling follows the active VS Code theme, including light and high-contrast.
- Every block the editor can produce survives a round trip; corpus passes byte-identical.
- An external image URL renders in the editor and saves as standard `![alt](https://…)`; dropping a
  local file does nothing rather than half-working.
- Deleted notes are recoverable from trash.
- Settings page reflects and writes the same values as VS Code's native settings UI.
- `.md` import and export both work losslessly.
- GitPad touches no file outside the vault.

---

## 3. Phase 2 — Optional Git sync

**Goal:** opt-in, invisible-when-working sync. The user never types a git command, never sees a
conflict marker, and never loses a keystroke.

### 3.1 Opt-in
Sync is off unless the user cloned a repo at setup or runs **GitPad: Enable Sync**. The entire sync
layer is lazily imported, so a sync-off user pays nothing in activation cost.

Setup offers:
1. **Create a new private repo** — Octokit `POST /user/repos` with `private: true`, seeded from
   current vault contents.
2. **Connect to an existing repo** — clone into an empty folder, or merge into a non-empty vault
   after an explicit warning.
3. **Adopt an existing local git repo** — vault already has `.git`. Permitted only for a repo
   GitPad created or one marked as a vault; anything else requires the explicit consent flow in
   §2.1, re-verified here rather than trusted from setup time.

Privacy is enforced, not requested: repo creation always sets `private: true`, and every sync
verifies the remote is still private. If it flipped to public, sync **pauses** and warns.

### 3.2 Auth & remote providers
`vscode.authentication.getSession('github', ['repo'], …)` — VS Code's built-in provider. No PAT
prompts, no tokens stored by us, works with the user's existing sign-in. Fall back to
`SecretStorage` for a manual PAT only where the built-in provider is unavailable.

`AuthService` and `RemoteProvider` are interfaces from day one. GitHub ships first;
**GitLab, Gitea, and plain SSH/HTTPS remotes** slot in as additional `RemoteProvider`
implementations without touching `SyncEngine`. Provider-specific logic is limited to: create repo,
check visibility, resolve credentials. Everything else is plain git.

### 3.3 Git implementation — `isomorphic-git` + `@octokit/rest`

Pure JS, no dependency on the user's git installation (frequently missing or misconfigured), works
identically across Windows/macOS/Linux and in remote extension hosts, and immune to surprises from
the user's global gitconfig, hooks, commit signing, or `core.autocrlf`.

The decisive reason is conflict handling: `git merge` writes `<<<<<<<` markers into files and
stops. In a live-rendering editor that's catastrophic. isomorphic-git exposes plumbing
(`readBlob`, `walk`, `writeTree`) so we read both sides and decide *before* anything touches disk.

Its throughput ceiling is irrelevant at notes-vault scale.

### 3.4 Sync scheduler — "5 s after idle"

```
activity signal ──► debounce(5 s, resettable) ──┐
window focus / blur ────────────────────────────┤
periodic timer (default 5 min) ─────────────────┼──► SyncQueue ──► SyncEngine.run()
extension activation ───────────────────────────┤    (single-flight,
manual "Sync now" command ──────────────────────┘     coalescing)
```

- Activity = any document edit event or vault filesystem change.
- The queue is **single-flight**: a request during an active run sets a dirty flag and reruns once
  at the end, rather than queueing N runs.
- Failures back off exponentially (5 s → 5 min cap) and surface in the status bar, not a modal.
- Offline is a normal state, not an error: commits accumulate locally, push resumes on reconnect.
- Status bar cycles `idle · pending · syncing · offline · conflict · paused`; click for a menu.

#### Sync UI

Two surfaces, deliberately non-redundant:

| Surface | Shows | Why there |
|---|---|---|
| **VS Code status bar** | persistent state icon | ambient, visible even when GitPad's panel is closed |
| **Sidebar footer bar** | transient result + manual controls | where you're already looking when working in GitPad |

The footer bar carries:
- **State line** — `Syncing…` → `✓ Synced just now` → fades to a quiet `Synced 4m ago`.
- **`⟳ Sync now`** — manual trigger, always available, including when auto-sync is off.
- **`↻ Reload`** — re-read the vault from disk and re-fetch the remote. The escape hatch for when
  something was changed outside GitPad and the view looks stale.
- **Conflict state** — replaces the line with a click-through to the Conflicts view (§3.6). This
  one does **not** auto-fade; it needs attention.

**The bar must not flash on every sync.** Sync runs every five idle seconds, and a banner blinking
that often is intolerable. Rule: **animate only when something actually changed** — commits made,
commits pulled, or an error. A no-op sync updates the timestamp silently and animates nothing.

#### Auto-sync is optional
`gitpad.sync.auto` (default on). Off means nothing syncs until `Sync now` is pressed — commits still
accumulate locally, so nothing is lost, it just doesn't leave the machine. Separate from
`gitpad.sync.enabled`, which turns the whole subsystem off.

### 3.5 One sync run

```
1. Stage & commit local changes           (skip if working tree clean)
2. Fetch remote
3. Compare local HEAD ↔ remote HEAD
   ├─ equal                    → done
   ├─ remote is ancestor       → push, done
   ├─ local is ancestor        → fast-forward, reload open editors, done
   └─ diverged                 → MergeEngine (§3.6) → commit merge → push
4. On push rejection (raced)   → goto 2, max 3 attempts
```

Every run holds a lock file in `.gitpad/` so two windows on the same vault can't interleave.

### 3.6 Automatic conflict handling

Per file, in order:

| Situation | Resolution |
|---|---|
| Changed on one side only | take that side |
| Both changed, type has a `merge` strategy | delegate to the document type (§4.3) |
| Both changed, text, no overlapping hunks | 3-way line merge (`node-diff3`) — silent, clean |
| Both changed, overlapping hunks | keep **local** at the original path, write remote as `Note (conflict from <device>, <date>).pad` beside it, link the two, list in the Conflicts view |
| Deleted one side, modified the other | keep the modified version |
| Both added same path, different content | keep both, rename one |

**The invariant: no automatic resolution may ever discard a byte of user content.** When in doubt,
duplicate. A stray extra file is a minor annoyance; one silently deleted paragraph ends trust in a
notes app permanently. Conflict copies are ordinary notes — editable, searchable, deletable with no
special machinery — and a "Conflicts" tree section lists them until resolved.

Every merge writes to an output channel, so "what happened to my note" is always answerable.

### 3.7 Commit policy & attribution
- Message: `Update <N> notes` / `Edit <filename>` — generated and human-readable, plus a
  machine-readable trailer (`GitPad-Device: <id>`) used for conflict-copy naming.
- Author = the user's git identity, or their identity from the auth session.
- **Co-author trailer** (`Co-authored-by: …`) on every commit, controlled by
  `gitpad.sync.attribution`. See §6 — disclose this in the setup wizard.

### 3.8 History compaction

Git keeps every version of every file forever, and **deleting a file does not reclaim its space** —
it stays in history. Left alone, a synced vault grows without bound.

#### What squashing actually reclaims
Squashing discards every stored version that isn't part of the *current* vault. It can never shrink
the repo below the size of the notes and assets you have right now.

- Old versions of edited notes → reclaimed
- Files deleted at some point in the past → reclaimed
- Anything currently in the vault → stays regardless

So the payoff scales with how much you've deleted or replaced. A vault that only ever grows gets
almost nothing back.

#### Policy
**Squash everything older than `gitpad.history.retentionDays` (default 7) into a single root
commit.** Runs on a schedule (monthly by default) with a notification, never silently.

> Note on the default: 7 days means the "restore this note to an earlier version" feature only
> reaches back a week. That's a deliberate trade of version history for repo size, and it's one
> setting away from changing.

A separate **"Remove large files from history"** action strips specific big blobs out of all past
commits while leaving the history intact — the right tool when one oversized file is the whole
problem.

#### The device-breaking catch
Compaction rewrites history, which requires a **force-push**, which invalidates every other device.
Their local history no longer shares an ancestor with the remote, and normal merging cannot
reconcile that.

GitPad must handle this, and **this recovery path has to be built before the compaction command
ships**:

1. Device detects its history is unrelated to the remote's.
2. Sets aside any local commits not yet pushed.
3. Re-clones the compacted remote.
4. Replays the set-aside work on top.

#### Honest limitation
Space isn't reclaimed until git repacks locally, and on the remote the old objects linger until
GitHub's own cleanup runs, which we don't control. The vault size shown in settings will lag
reality. Say so in the UI rather than promising a drop that doesn't visibly happen.

#### Priority note
With file uploads out of scope (§2.5), a vault is **pure text**, and text is exactly what git is
good at — a year of heavy note-taking might pack down to a few tens of megabytes. The size problem
this feature exists to solve barely exists yet.

So compaction stays in the plan and keeps its 7-day default, but it drops behind the sync work in
priority. It becomes urgent the day uploads land, not before. Version history is arguably the more
valuable half of it in the meantime — which is worth remembering, since a 7-day retention throws
that history away.

### 3.9 Phase 2 exit criteria
- Two machines editing the same vault converge without user intervention.
- Killing the network mid-sync and restoring it loses nothing.
- Editing the same paragraph on two machines yields two files, not one mangled one.
- Sync disabled = zero network, zero git, zero added activation cost.

---

## 4. Phase 3 — Boards, flowcharts, and beyond

**Goal:** prove the registry abstraction by adding two non-text types that require no changes to
the tree, search, sync, or conflict layers.

### 4.1 Format
`.padboard` and `.padflow`, containing **deterministic pretty-printed JSON** — one node per line
block, stable key order, stable ID ordering. Determinism is what makes Git diffs readable and
3-way merges viable. `.gitattributes` marks them `diff=json`.

### 4.2 Types to ship
- **Board (kanban):** columns + cards; cards can link to notes. `@dnd-kit` for drag/drop.
- **Flowchart:** **React Flow (`@xyflow/react`)** — its nodes/edges model maps directly to a JSON
  document, with built-in pan/zoom/minimap/handles. MIT.
- Later, same registry, no new plumbing: freeform canvas (`@excalidraw/excalidraw`), table/database
  view, daily journal.

### 4.3 Structured merge
Each type implements `MergeStrategy` and gets semantic merging instead of line merging:
- Board: card moved on A, renamed on B → both apply. Deleted on A, edited on B → keep, flag.
- Flowchart: node position is last-write-wins (positions aren't precious); node/edge
  add/remove/relabel merge set-wise by stable ID.
- Fallback for anything unimplemented is the Phase 2 text policy — never a hard failure.

**Stretch:** for a type where semantic merge gets hairy, a CRDT (`@automerge/automerge` or Yjs)
makes merging provably conflict-free at the cost of an opaque blob in Git. Per-type opt-in, not
global; the `MergeStrategy` interface already accommodates either.

### 4.4 Cross-type payoff
Board cards and flowchart nodes can link to notes, and backlinks work, because both implement
`extractLinks`. Search covers all types because both implement `extractText`. Neither required a
change outside their own file.

---

## 5. Cross-cutting

### 5.1 Licensing constraint (hard requirement)

GitPad is free and open source. Every dependency must be permissively licensed with **no paid tier
gating features we depend on**. This has already changed decisions:

- **Tiptap — rejected.** Core is MIT, but the extensions that make it feel like Notion (drag
  handle among them) are paid Pro.
- **BlockNote — rejected.** Core is MIT; the `xl-*` packages carry a separate commercial license.
  Verify terms before touching those if this is ever revisited.
- **Milkdown, CodeMirror 6, Lexical, ProseMirror, isomorphic-git, React Flow, remark/unified,
  dnd-kit, react-arborist — all MIT, no paid tiers.**
- **`@vscode/codicons` — CC BY 4.0, not MIT.** Free and permissive, but the only dependency so far
  that **requires attribution**. Credited in the README; keep that credit if the icons stay.

Rule going forward: check the license and the existence of a "Pro" tier before adding any
dependency. Record it in `docs/adr/`.

### 5.2 Real-time collaboration — explicitly out of scope

Multiple live cursors in one document requires a relay server running continuously. That's a
recurring bill, which contradicts free-forever. Git sync is the free alternative: asynchronous,
no infrastructure, no cost.

If ever revisited: Yjs works with Milkdown (`@milkdown/plugin-collab`), CodeMirror, and Lexical,
and a peer-to-peer WebRTC provider could avoid a server. Phase 5 at the earliest. Not now.

### 5.3 Testing
- **`vitest`** for domain, sync, and markdown logic — no `vscode` import, so it just runs. This is
  where the real coverage lives.
- **`@vscode/test-cli`** for integration: tree operations, editor open/save, command registration.
- **Sync simulator:** two vault dirs + a bare repo in a temp folder, scripted concurrent edits,
  asserting convergence and zero content loss. Non-negotiable before Phase 2 ships.
- Round-trip golden corpus (§2.3) on every commit.

### 5.4 Settings — and a dedicated settings page

GitPad ships **its own settings screen** (a webview panel, command `GitPad: Settings`, also reachable
from a gear on the tree view). VS Code's native settings UI is a flat list of key/value rows and
can't host what this extension actually needs to show:

- Current vault path, size on disk, and repo size, with a "Change vault" action
- Sync status, connected account, connected repo, sign in / out
- **Actions, not settings**: Compact history now · Find broken links · Empty trash · Re-index search
- The attribution toggle, disclosed in context rather than buried (§3.7)
- Grouped, explained options — asset limits and history retention need a sentence each, not a
  tooltip

**Hard rule: the page reads and writes VS Code configuration, it never keeps its own copy.**
Everything settable in our page stays settable in the native settings UI and in `settings.json`, and
a change in either place shows up in the other immediately. Forking config state into our own file
would create two sources of truth that silently disagree. Actions (the list above) exist only in our
page, since they aren't settings at all.

Sections: **Vault · Editor · Sync · Assets · History · Trash · About**.

```
gitpad.vault.path

gitpad.editor.spellCheck | .fontSize | .lineWidth | .loadRemoteImages (true)

gitpad.sidebar.showRecentlyOpened (true) | .recentlyOpenedCount (5)

gitpad.sync.enabled | .auto (true) | .idleDelayMs (5000) | .pollIntervalMs
gitpad.sync.attribution | .onStartup

gitpad.history.autoCompact (true)    | .retentionDays (7) | .compactIntervalDays (30)

gitpad.trash.retentionDays (30)

gitpad.telemetry.enabled             ← ships false; likely never used
```

### 5.5 UI / theming

**GitPad has no colour palette of its own. It inherits the user's VS Code theme, entirely.**
Nothing should look out of place next to the editor it's embedded in.

Both webviews are in scope: the editor **and** the sidebar (§2.2). The sidebar is the harder case —
it sits directly beside native VS Code chrome, so any mismatch in row height, hover colour, focus
ring, or font is immediately visible by comparison.

- **Zero hardcoded colours.** Everything resolves from VS Code's CSS custom properties —
  `--vscode-editor-background`, `--vscode-editor-foreground`, `--vscode-textLink-foreground`,
  `--vscode-focusBorder`, and so on. Light, dark, and high-contrast then work for free, including
  third-party themes we've never seen.
- **Crepe ships its own CSS theme and must be fully restyled** onto those variables. This is real
  work, scheduled at M3 step 5, not an afterthought.
- **Crepe's floating surfaces** — slash menu, block handle, selection toolbar, link tooltip — must
  read as VS Code UI (`--vscode-menu-*`, `--vscode-quickInput-*`), not as a web app embedded in a
  tab. These are the pieces most likely to give the game away.
- **No web fonts.** Use the user's configured editor font, with a proportional fallback for prose.
- Status bar, notifications, and Quick Picks remain native VS Code UI and inherit theming free.
  The sidebar deliberately does not (§2.2) — which is exactly why its styling needs the most care.
- The settings page (§5.4) is a webview and falls under all of the above.

### 5.6 Performance, errors, docs
- **Activation event: `onStartupFinished`** — GitPad activates with VS Code, not lazily when its
  panel is first opened. The reason is sync: a lazily-activated extension doesn't pull changes from
  other devices until you remember to click its icon, so the vault would be stale exactly when you
  go looking at it. `onStartupFinished` runs *after* VS Code's own boot, so it doesn't delay the
  editor becoming usable.
- The budget holds only if activation itself stays cheap: register commands, start the file watcher,
  schedule the first sync, and stop. **< 100 ms.** The sidebar bundle loads when the panel is first
  revealed, not at activation; the sync layer isn't imported at all when sync is off.
- Tree responsive at 5 000 notes; index build off the UI thread with progress.
- One output channel `GitPad`, structured logs, "Report issue" action on unexpected errors. Sync
  errors never block editing.
- README rewrite at the end of each phase, CHANGELOG per release, `docs/adr/` capturing the
  decisions in §1.3, §1.4, §2.4, §3.3, §4.1 so the reasoning survives.

---

## 6. Risks & flagged decisions

| Risk | Mitigation |
|---|---|
| **Markdown round-trip loss** — the one that could kill the product | Milkdown/remark shared pipeline + golden corpus from commit one |
| Custom editor undo bridge feels wrong | Prototype at step 3 of §2.4, before building on top of it |
| Merge engine silently loses content | "Never discard, always duplicate" invariant + sync simulator |
| Notes land in the user's code repo | Vault picker never defaults to the open workspace; ancestor-walking git detection at pick time **and** at sync-enable time; sync auto-enables only for GitPad-created or GitPad-marked repos (§2.1) |
| Milkdown is a smaller project (bus factor) | Sits on ProseMirror (stable, decade-old); `DocumentType` keeps the editor swappable; Lexical and CodeMirror 6 are the identified fallbacks |
| A Crepe block has no markdown form and silently drops on save | The §2.4 hard rule + the block audit at M3 step 4; fixtures for every block we keep |
| Crepe's opinionated CSS looks alien inside VS Code | §5.5 restyling is a scheduled task at M3 step 5, not an afterthought |
| A dependency adds a paid tier later | §5.1 review gate; prefer libraries with no commercial arm |
| Compaction force-push breaks other devices | Re-clone recovery path is built first, at M8, before the command ships (§3.8) |
| Remote images expose the reader's IP to third-party hosts | `https:` only, never `http:`; `gitpad.editor.loadRemoteImages` to disable; no other CSP relaxation (§2.5) |
| Webview sidebar re-implements tree affordances worse than native | `react-arborist` covers nav/dnd/virtualization/rename; context menus and ARIA are the genuinely new work and are scoped at M1 (§2.2) |
| Sidebar bundle inflates activation time | Code-split, kept small, measured against the <100 ms budget (§5.6) |
| Sync bar flashing every 5 s becomes intolerable | Animate only on actual change — no-op syncs update the timestamp silently (§3.4) |
| Notes depend on URLs that can rot or go offline | Inherent to external-only images; the eventual upload feature (§2.5) is the real fix |

**One thing worth deciding deliberately:** the co-author trailer adding your ID to every commit.
It's your extension and your repo, and it's straightforwardly implementable — but a user who
notices a third party on every commit in their *private* notes repo without having been told will
read it as something worse than it is. Recommendation: keep it default-on as you want, and disclose
it explicitly in the one-time sync setup wizard with the toggle right there
(`gitpad.sync.attribution`), plus a line in the README. Same outcome, no ambush.

---

## 7. Sequencing

| Milestone | Contents |
|---|---|
| **M0** | esbuild build, folder structure, interfaces/DI, logging, vitest + integration harness |
| **M1** | Webview host + RPC layer; vault setup flow (new / open existing); sidebar tree with `react-arborist`, search box, recently opened, context menus; file CRUD |
| **M2** | Custom editor with plain-text editing — proves the editor plumbing separately from the sidebar |
| **M3** | Crepe editor, markdown pipeline, block audit, VS Code theming, round-trip corpus, images, wikilinks |
| **M4** | Trash, search + link index + backlinks, `.md` import/export, settings page → **Phase 1 ships** |
| **M5** | Auth, repo create/clone wizard, GitService, manual "Sync now" |
| **M6** | Scheduler, status bar, offline/backoff |
| **M7** | MergeEngine, conflict policy, sync simulator → **Phase 2 ships** |
| **M8** | History compaction + the re-clone recovery path (lower priority now — see §3.8) |
| **M9** | Board type + structured merge |
| **M10** | Flowchart type, cross-type links → **Phase 3 ships** |
| **later** | File uploads (§2.5), if and when they earn their complexity |

M0–M2 are architecture investment with little visible output. They're what make M9 and M10 cost days
instead of weeks — worth resisting the urge to skip.

---

## 8. Dependencies (proposed — all MIT, no paid tiers)

**Phase 1** — `unified`, `remark-parse`, `remark-stringify`, `remark-gfm`, `remark-frontmatter`,
`gray-matter`, `@milkdown/crepe` (+ `@milkdown/core` and the presets it pulls in), optionally
`remark-math`, **React** and **`react-arborist`** (webview sidebar, §2.2), `flexsearch`, `esbuild`,
`vitest`

**Phase 2** — `isomorphic-git`, `@octokit/rest`, `node-diff3`

**Phase 3** — `@xyflow/react`, `@dnd-kit/core`, optionally `@automerge/automerge`
(React already present from Phase 1)

Webview deps stay out of the extension bundle; Phase 2/3 deps load lazily.
