# CLAUDE.md

Guidance for agents working on GitPad — a VS Code extension providing a Git-backed notes workspace.

## Read these first

- **[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** — the design and, more importantly,
  the *reasoning*. Every non-obvious choice here was argued through; the plan records why.
- **[docs/PROGRESS.md](docs/PROGRESS.md)** — what's actually built, with commit references, and the
  open questions still unvalidated.

This file is an **index, not a summary**. Don't restate the plan here — two copies drift, and a
drifted instruction file confidently tells you the wrong thing. Link to the plan instead.

## Current state

Pre-M0. The repo is a bare scaffold: [src/extension.ts](src/extension.ts) is an empty `activate()`,
`contributes` is `{}`, and the build is plain `tsc`. Essentially everything is greenfield.

```bash
npm run compile     # tsc -p ./          (M0 replaces this with esbuild, two targets)
npm run watch
npm run package     # vsce package
```

Press `F5` to launch the Extension Development Host.

## How to write code here

**Follow the repository layout in §1.8 of the plan.** It isn't decoration — each concern lives in
one place so that a future change touches one folder instead of five.

- **Keep the blast radius small.** One concern per file, clear seams between parts. Before adding
  code, ask which single folder should own it. If the answer is "several," the design is wrong.
- **Clean and simple over clever.** Predictable beats condensed. This codebase will be read far more
  often than it is written.
- **Inline comments explaining *why*, not *what*.** The plan holds the long reasoning; a comment
  holds the short version at the point it matters — the non-obvious constraint, the reason the naive
  version would be wrong. Don't narrate what the line plainly does.
- **`sync/` does not exist until Phase 2.** Don't stub it. An absent folder can't be depended on by
  accident.

## Rules that are easy to break by accident

These are the ones worth stating outright. Everything else, consult the plan.

1. **The domain layer must not import `vscode`.** It takes a `FileSystem` interface instead. This is
   what keeps merge logic, the markdown pipeline, and the link index testable in plain vitest
   without an extension host — which is where most of the real bugs will be. Easiest rule to
   violate, most expensive to unpick. (§1.1)
2. **New document types implement `DocumentType`** — never by editing the tree, sync, search, or
   conflict code. That registry is the whole architecture; routing around it defeats the point.
   (§1.2)
3. **Every editor block must have a markdown form.** `.pad` files store markdown, so a block that
   can't serialize can't be saved — the user types it, closes the file, and it's gone. Anything we
   keep needs a round-trip fixture. (§2.4)
4. **No merge may ever discard user content.** When in doubt, duplicate. A stray extra file is an
   annoyance; one silently deleted paragraph permanently ends trust in a notes app. (§3.6)
5. **No hardcoded colours.** Everything resolves from VS Code CSS variables
   (`--vscode-editor-background`, …) so light, dark, high-contrast, and unknown third-party themes
   all work for free. (§5.5)
6. **Check licensing before adding a dependency.** GitPad is free and open source; a dependency with
   a paid tier gating features we depend on is disqualified. Tiptap and BlockNote were rejected on
   exactly this. (§5.1)

## Deliberately out of scope

Cut on purpose after discussion. Reinstating them "helpfully" is a real failure mode, not a
contribution:

- **File uploads / local assets** — images are external URLs only for now. The full design (content
  hashing, downscaling, orphan collection) is preserved in §2.5 for when it returns.
- **Real-time collaboration** — needs a relay server, which is a recurring bill, which breaks
  free-forever. Git sync is the async alternative. (§5.2)

## Conventions

- Update **docs/PROGRESS.md** when finishing a chunk of work — what changed, commit SHA, and any
  deviation from the plan.
- **If reality contradicts the plan, update the plan** in the same change. A plan nobody corrects
  stops being worth reading.
- Record significant architectural decisions in `docs/adr/`.
