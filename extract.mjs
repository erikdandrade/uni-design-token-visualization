#!/usr/bin/env node
// Extracts SCSS-variable token usage from an Angular codebase into dataset.json.
// Usage: node extract.mjs [--source <path>] [--out <path>]

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const SOURCE = resolve(args.source || join(__dirname, '..', 'unifonic-spa-common'));
const OUT = resolve(args.out || join(__dirname, 'dataset.json'));

if (!existsSync(SOURCE)) {
  console.error(`Source not found: ${SOURCE}`);
  process.exit(1);
}

const SETTINGS_DIR = join(SOURCE, 'src', 'styles', 'settings');
const SRC_DIR = join(SOURCE, 'src');

function walk(dir, pattern) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, pattern));
    else if (pattern.test(entry)) out.push(full);
  }
  return out;
}

function categoryFromSettingsFile(file) {
  const base = basename(file).replace(/^_/, '').replace(/\.scss$/, '');
  if (base.startsWith('colors')) return 'color';
  if (base === 'theme') return 'color';
  if (base === 'typography' || base === 'fonts') return 'typography';
  if (base === 'shadows') return 'shadow';
  if (base === 'borders') return 'border';
  if (base === 'dimensions') return 'dimension';
  if (base === 'breakpoints') return 'breakpoint';
  if (base === 'animations') return 'animation';
  return base;
}

function inferValueType(value, category) {
  if (category === 'color' || /^#|^rgb|^hsl/.test(value)) return 'color';
  if (/\d+(px|rem|em|%|vh|vw)/.test(value)) return 'dimension';
  if (category === 'typography') return 'typography';
  return 'string';
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

// --- Token discovery ---
const declRegex = /^\s*\$([a-zA-Z0-9_-]+)\s*:\s*([^;]+?)\s*(?:!default)?\s*;/gm;
const tokensByName = new Map();

for (const file of walk(SETTINGS_DIR, /\.scss$/)) {
  const src = stripComments(readFileSync(file, 'utf8'));
  const category = categoryFromSettingsFile(file);
  let m;
  declRegex.lastIndex = 0;
  while ((m = declRegex.exec(src))) {
    const [, name, rawValue] = m;
    const value = rawValue.trim();
    // Last declaration wins (mirrors SCSS precedence within import order)
    tokensByName.set(name, {
      name,
      category,
      type: inferValueType(value, category),
      values: { default: value },
      declaredIn: relative(SOURCE, file),
    });
  }
}

// --- Alias edges (token -> token) ---
const tokenRefRegex = /\$([a-zA-Z0-9_-]+)/g;
const aliasEdges = [];
for (const tok of tokensByName.values()) {
  const v = tok.values.default;
  tokenRefRegex.lastIndex = 0;
  let m;
  const refs = new Set();
  while ((m = tokenRefRegex.exec(v))) {
    if (tokensByName.has(m[1]) && m[1] !== tok.name) refs.add(m[1]);
  }
  for (const ref of refs) aliasEdges.push({ from: tok.name, to: ref });
}

// --- Component discovery ---
const componentTs = walk(SRC_DIR, /\.component\.ts$/);
const components = [];

const decoratorRegex = /@Component\s*\(\s*\{([\s\S]*?)\}\s*\)/m;
const selectorRegex = /selector\s*:\s*['"`]([^'"`]+)['"`]/;
const styleUrlsRegex = /styleUrls\s*:\s*\[([^\]]*)\]/;
const templateUrlRegex = /templateUrl\s*:\s*['"`]([^'"`]+)['"`]/;
const inlineTemplateRegex = /template\s*:\s*([`'"])([\s\S]*?)\1/;
const classNameRegex = /export\s+class\s+([A-Za-z0-9_]+)/;
const urlEntryRegex = /['"`]([^'"`]+)['"`]/g;

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function displayNameFromSelector(sel) {
  return sel
    .replace(/^uni-/, '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function findBindingsInScss(scss) {
  const cleaned = stripComments(scss);
  const bindings = [];
  // Track current selector stack via brace nesting (simplified — handles depth 1+).
  const selectorStack = [];
  let buf = '';
  let lastRule = '';
  let pendingProp = '';
  // Light-weight parser: walk char by char, track braces, capture "prop: value;" inside rules.
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (ch === '{') {
      const sel = buf.trim().replace(/\s+/g, ' ');
      selectorStack.push(sel);
      lastRule = selectorStack.join(' > ');
      buf = '';
      i++;
    } else if (ch === '}') {
      selectorStack.pop();
      lastRule = selectorStack.join(' > ');
      buf = '';
      i++;
    } else if (ch === ';') {
      const stmt = buf.trim();
      buf = '';
      i++;
      // Match prop: value (skip @-rules and $-vars at statement level)
      const declMatch = stmt.match(/^([@a-zA-Z-][a-zA-Z0-9_-]*)\s*:\s*([\s\S]+)$/);
      if (declMatch) {
        const prop = declMatch[1];
        const value = declMatch[2];
        if (!prop.startsWith('$') && !prop.startsWith('@')) {
          tokenRefRegex.lastIndex = 0;
          let r;
          while ((r = tokenRefRegex.exec(value))) {
            if (tokensByName.has(r[1])) {
              bindings.push({
                token: r[1],
                context: prop,
                selector: lastRule || ':host',
              });
            }
          }
        }
      }
    } else {
      buf += ch;
      i++;
    }
  }
  return bindings;
}

for (const tsFile of componentTs) {
  const tsSrc = readFileSync(tsFile, 'utf8');
  const decMatch = tsSrc.match(decoratorRegex);
  if (!decMatch) continue;
  const decoratorBody = decMatch[1];
  const selMatch = decoratorBody.match(selectorRegex);
  if (!selMatch) continue;
  const selector = selMatch[1];
  const className = (tsSrc.match(classNameRegex) || [])[1] || selector;

  const styleUrlsMatch = decoratorBody.match(styleUrlsRegex);
  const scssFiles = [];
  if (styleUrlsMatch) {
    let u;
    urlEntryRegex.lastIndex = 0;
    while ((u = urlEntryRegex.exec(styleUrlsMatch[1]))) {
      const rel = u[1];
      const abs = resolve(dirname(tsFile), rel);
      if (existsSync(abs)) scssFiles.push(abs);
    }
  }

  const allBindings = [];
  for (const scssFile of scssFiles) {
    const scss = readFileSync(scssFile, 'utf8');
    allBindings.push(...findBindingsInScss(scss));
  }
  // Dedupe (same token + same context + same selector)
  const seen = new Set();
  const bindings = [];
  for (const b of allBindings) {
    const k = `${b.token}|${b.context}|${b.selector}`;
    if (seen.has(k)) continue;
    seen.add(k);
    bindings.push(b);
  }

  // Capture template text (external file or inline) for later dependency scan.
  let templateText = '';
  const templateUrlMatch = decoratorBody.match(templateUrlRegex);
  if (templateUrlMatch) {
    const abs = resolve(dirname(tsFile), templateUrlMatch[1]);
    if (existsSync(abs)) templateText = readFileSync(abs, 'utf8');
  } else {
    const inlineMatch = decoratorBody.match(inlineTemplateRegex);
    if (inlineMatch) templateText = inlineMatch[2];
  }

  components.push({
    name: selector,
    displayName: displayNameFromSelector(selector),
    className,
    path: relative(SOURCE, tsFile),
    tokenBindings: bindings,
    _templateText: templateText, // stripped before write
  });
}

// --- Component-to-component edges (template tag references) ---
const selectorSet = new Set(components.map(c => c.name));
const tagRegex = /<([a-z][a-z0-9-]*)/gi;
const componentEdges = [];
const seenEdges = new Set();

for (const c of components) {
  const html = stripHtmlComments(c._templateText || '');
  const refs = new Set();
  tagRegex.lastIndex = 0;
  let m;
  while ((m = tagRegex.exec(html))) {
    const tag = m[1].toLowerCase();
    if (tag === c.name) continue; // drop self-edges
    if (selectorSet.has(tag)) refs.add(tag);
  }
  c.componentDependencies = [...refs].sort();
  for (const to of refs) {
    const key = `${c.name}|${to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    componentEdges.push({ from: c.name, to });
  }
  delete c._templateText;
}

const dataset = {
  themes: ['default'],
  tokens: [...tokensByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
  components: components.sort((a, b) => a.name.localeCompare(b.name)),
  aliasEdges,
  componentEdges,
};

writeFileSync(OUT, JSON.stringify(dataset, null, 2));

const bindingCount = components.reduce((n, c) => n + c.tokenBindings.length, 0);
const usedTokens = new Set();
for (const c of components) for (const b of c.tokenBindings) usedTokens.add(b.token);
const compsWithDeps = components.filter(c => c.componentDependencies.length > 0).length;

console.log(`Wrote ${OUT}`);
console.log(`  tokens: ${dataset.tokens.length} (${usedTokens.size} referenced, ${dataset.tokens.length - usedTokens.size} orphan)`);
console.log(`  components: ${dataset.components.length} (${compsWithDeps} with template deps)`);
console.log(`  bindings: ${bindingCount}`);
console.log(`  alias edges: ${aliasEdges.length}`);
console.log(`  component edges: ${componentEdges.length}`);
