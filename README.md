# GitPad

A Git-powered workspace for notes, to-do lists, and flowcharts — all inside VS Code. Keep your ideas alongside your code and sync them across devices using Git and GitHub.

## Status

Early development. The vault, sidebar and note management work; the rich editor and Git sync do not exist yet.

See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for the design and [docs/PROGRESS.md](docs/PROGRESS.md) for what is actually built.

## Development

```bash
npm install
npm run compile          # build extension + webview
npm run watch            # rebuild on save
npm run typecheck        # esbuild does not typecheck; this does
npm run lint
npm test                 # unit tests (fast, no editor)
npm run test:integration # boots a real VS Code
```

Press `F5` in VS Code to launch the Extension Development Host.

## Licence

GitPad is MIT licensed. See [LICENSE](LICENSE).

### Third-party

Icons are [Codicons](https://github.com/microsoft/vscode-codicons) by Microsoft, licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
