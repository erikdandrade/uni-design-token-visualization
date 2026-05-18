# Unifonic Design Token Visualization

A web app for visualizing design tokens and their relationships as an interactive graph. Built on Vite + Lit + Spectrum Web Components.

Originally extracted from [`adobe/spectrum-design-data`](https://github.com/adobe/spectrum-design-data) (the `docs/s2-visualizer` package).

## Requirements

- Node.js 20.x
- pnpm (recommended) or npm

## Local development

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build
```

Outputs static assets to `dist/`.

## Deploy on Vercel

This is a standard Vite project. Vercel auto-detects:

- **Framework Preset**: Vite
- **Build Command**: `pnpm build`
- **Output Directory**: `dist`
- **Install Command**: `pnpm install`

No `vercel.json` required.
