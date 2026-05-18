# Unifonic Component ↔ Token Graph

Visualizes which SCSS tokens each Angular component in `unifonic-spa-common`
consumes, and the reverse (which components reference a given token). Inspired
by Adobe Spectrum's `s2-visualizer`, but tailored to Unifonic's stack
(Angular + SCSS variables + `styleUrls`).

## Layout

```
.
├── extract.mjs      # Node script — walks unifonic-spa-common and writes dataset.json
├── dataset.json     # Generated artifact (re-run extract.mjs to refresh)
├── index.html       # Vite entry
├── src/             # Viewer source (main.js, styles.css)
├── vite.config.js
└── README.md
```

## Quickstart

```bash
pnpm install

# Refresh the graph data (default source: ../unifonic-spa-common)
pnpm extract

# Launch the viewer
pnpm dev          # http://localhost:5174
```

## Deploy on Vercel

Standard Vite project — Vercel auto-detects:

- **Framework Preset**: Vite
- **Build Command**: `pnpm build`
- **Output Directory**: `dist`
- **Install Command**: `pnpm install`

`dataset.json` is bundled at build time via the `@dataset` import alias in
`vite.config.js`, so refreshing the dataset means re-running `pnpm extract`
locally and committing the updated `dataset.json` before pushing.

To point the extractor at a different working copy:

```bash
node extract.mjs --source /path/to/unifonic-spa-common --out ./dataset.json
```

## Viewer behavior

Three vertical lanes:

| Lane                | Contents                                       |
| ------------------- | ---------------------------------------------- |
| Components          | Every Angular component, alphabetical          |
| Aliases (tokens)    | SCSS variables the *selected* component(s) use |
| Raw values          | Terminal tokens that those aliases resolve to  |

Interactions:

- **Initial state**: only the Components lane is populated.
- **Click a component**: its directly-used tokens fill the Aliases lane;
  the terminals those tokens resolve to (via the alias chain) fill the Raw
  lane. Bezier curves connect the three lanes.
- **Click a second component (toggle)**: its tokens are added to the union.
  Tokens shared by two or more selected components light up in **yellow** so
  shared dependencies are obvious. Click a selected component again to
  deselect.
- **Click an alias or raw node**: the right-side details pane shows the
  token's value, type, declaration site, alias chain, and the full list of
  components that reference it directly.
- **Filter** the components lane with the search box.
- **Clear selection** resets to the initial Components-only view.

## Dataset shape (`dataset.json`)

```json
{
  "themes": ["default"],
  "tokens": [
    {
      "name": "color-grey-light",
      "category": "color",
      "type": "color",
      "values": { "default": "$color-neutral-100" },
      "declaredIn": "src/styles/settings/_colors.scss"
    }
  ],
  "components": [
    {
      "name": "uni-card-header",
      "displayName": "Card Header",
      "className": "UniCardHeaderComponent",
      "path": "src/modules/uni-card/components/uni-card-header/uni-card-header.component.ts",
      "tokenBindings": [
        { "token": "color-grey-light", "context": "background-color", "selector": ":host > &.uni-card--default" }
      ]
    }
  ],
  "aliasEdges": [ { "from": "color-grey-light", "to": "color-neutral-100" } ]
}
```

`values` is a per-theme map so additional themes (light/dark/…) can be added
later without changing consumers. `aliasEdges` capture token→token
references; the viewer follows these transitively to find the terminal value
shown in the Raw column.

## How the extractor works

1. **Tokens** — every `_*.scss` under `src/styles/settings/` is scanned for
   `$name: value;` declarations. Category is inferred from the filename
   (`_colors*.scss` → `color`, `_typography.scss` → `typography`, …).
2. **Components** — every `*.component.ts` is parsed (regex on the `@Component`
   decorator) to extract `selector` + `styleUrls`. Each style file is then
   tokenized with a light-weight brace-aware scanner that records every
   `prop: value;` declaration whose value contains a known `$token`.
3. **Bindings** are deduplicated by `(token, css-property, selector)`.

Excluded from v1 (easy to add later if needed):

- inline `styles:` arrays in the `@Component` decorator
- runtime `[style.color]` bindings in templates
- CSS custom properties (`--color-primary`) — none observed in Unifonic today

## Refreshing the data

The dataset is *not* watched. Re-run `node extract.mjs` whenever the SCSS or
component sources change. The viewer hot-reloads automatically once
`dataset.json` is updated.
