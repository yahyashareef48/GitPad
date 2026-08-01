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
| **M0** | esbuild build, folder structure, interfaces/DI, logging, vitest + integration harness | In progress |
| **M1** | Webview host + RPC; vault setup flow; sidebar tree, search box, recently opened, context menus; file CRUD | Not started |
| **M2** | Custom editor with plain-text editing — proves the editor plumbing | Not started |
| **M3** | Crepe editor, markdown pipeline, block audit, VS Code theming, round-trip corpus, wikilinks | Not started |
| **M4** | Trash, search + link index + backlinks, `.md` import/export, settings page → **Phase 1 ships** | Not started |
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
| 1 | Does the Ctrl+Z bridge (VS Code → RPC → ProseMirror history) feel correct — right granularity, focus reaches us, no drift between VS Code's edit count and ProseMirror's? | M2 | Open |
| 2 | Which Crepe blocks survive a markdown round trip, and which get disabled? | M3 | Open |
| 3 | How much work is restyling Crepe onto VS Code theme variables, really? | M3 | Open |
| 4 | Does `react-arborist` + hand-built context menus reach parity with a native tree? | M1 | Open |

---

## Log

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
