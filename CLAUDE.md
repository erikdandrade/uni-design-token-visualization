# Unifonic Token Graph — Project Context

Static Vite app that visualizes the `unifonic-spa-common` Angular codebase as an interactive Cytoscape graph: components ↔ SCSS tokens, and components ↔ components.

## Layout (flat repo, single Vite project at root)

- `extract.mjs` — scans `../unifonic-spa-common`, writes `dataset.json`. Idempotent. Run when source changes.
- `dataset.json` — the graph data. Bundled at build time via the `@dataset` Vite alias in `vite.config.js`.
- `src/main.js`, `src/styles.css`, `index.html` — Cytoscape viewer.
- `package.json` scripts: `dev`, `build`, `preview`, `extract`.

## Run

```
pnpm install && pnpm dev   # http://localhost:5174
pnpm extract               # refresh dataset.json from ../unifonic-spa-common
```

## Data source

The extractor expects `../unifonic-spa-common/src` (sibling directory). Override with `node extract.mjs --source <path>`. Today's dataset: 289 components, 582 tokens, 583 component edges, 404 alias edges.

## Viewer modes

Five modes, all share the 3-column lane layout (col 1 = pivot, col 2 = direct, col 3 = transitive):

- `comp-alias-raw` — Component → tokens it uses → terminal raw values
- `alias-comp` — Token → components using it (no col 3)
- `raw-alias` — Raw value → aliases resolving to it (no col 3)
- `comp-uses` — Component → components it renders (template tags) → transitive renders
- `comp-used-by` — Component → its template consumers → transitive consumers

Component-to-component edges come from parsing `templateUrl` + inline `template:` in each `@Component` and matching tag names against the known selector set. **Out of scope:** routing/lazy-loaded children, `NgComponentOutlet`, `ComponentFactoryResolver`.

## One non-obvious viewer pattern

In the two component-to-component modes, a single component can appear in col 1 AND col 2/3 at the same time (e.g. clicking `uni-button` → `uni-icon` shows in col 2; `uni-icon` should stay readable in col 1, dimmed). To support this, each component has **three pre-rendered Cytoscape node instances**: `c1:<name>`, `c2:<name>`, `c3:<name>`. `nodeIdFor(kind, name, lane)` picks the right one. Tokens use a single `t:<name>` instance since col 1 is always component-kind. The `.dimmed` class (opacity 0.35) is added to col 1 entries that overlap col 2/3 only when pivot/col2/col3 are all component-kind.

## Deploy

Vercel auto-detects: Vite preset, `pnpm install && pnpm build`, output `dist/`. No `vercel.json` needed.

## pnpm version pin

`packageManager: pnpm@10.17.1` is pinned in `package.json` (Vercel honors it via corepack). pnpm 11 treats the esbuild post-install warning as fatal; `pnpm-workspace.yaml` has `allowBuilds: { esbuild: true }` to handle that case for anyone on pnpm 11 locally.

## Provenance

This repo started as a fork of `adobe/spectrum-design-data` (history visible in early commits). Adobe's `s2-visualizer` was the *inspiration* for the layout pattern, not a code source — the actual viewer is a Cytoscape-based reimplementation.
