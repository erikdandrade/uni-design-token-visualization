import cytoscape from 'cytoscape';
import dataset from '@dataset';

// --- Layout constants ---
const COL_X = { 1: 0, 2: 700, 3: 1500 };
const NODE_W = { component: 220, token: 360 };
const ROW_H = 30;

// --- Lookups ---
const tokenByName = new Map(dataset.tokens.map((t) => [t.name, t]));
const components = [...dataset.components].sort((a, b) => a.name.localeCompare(b.name));
const allTokens = [...dataset.tokens].sort((a, b) => a.name.localeCompare(b.name));

// Map: tokenName -> [aliasTargets...]
const aliasOut = new Map();
for (const t of dataset.tokens) aliasOut.set(t.name, []);
for (const e of dataset.aliasEdges || []) {
  if (aliasOut.has(e.from)) aliasOut.get(e.from).push(e.to);
}

// Resolve a token to its terminal(s): tokens with no outgoing alias edges.
const terminalCache = new Map();
function resolveTerminals(name) {
  if (terminalCache.has(name)) return terminalCache.get(name);
  const out = new Set();
  const seen = new Set();
  (function walk(n) {
    if (seen.has(n)) return;
    seen.add(n);
    const outs = aliasOut.get(n) || [];
    if (outs.length === 0) out.add(n);
    else outs.forEach(walk);
  })(name);
  terminalCache.set(name, out);
  return out;
}

// Reverse map: terminal -> set of tokens whose terminal set contains it
const aliasesResolvingTo = new Map(); // terminalName -> Set(tokenName)
for (const t of allTokens) {
  for (const term of resolveTerminals(t.name)) {
    if (term === t.name) continue;
    if (!aliasesResolvingTo.has(term)) aliasesResolvingTo.set(term, new Set());
    aliasesResolvingTo.get(term).add(t.name);
  }
}

// Map: component.name -> Set(tokenName) of directly referenced tokens
const componentAliases = new Map();
for (const c of components) {
  const set = new Set();
  for (const b of c.tokenBindings) if (tokenByName.has(b.token)) set.add(b.token);
  componentAliases.set(c.name, set);
}
// Reverse: tokenName -> Set(component.name) that use it directly
const tokenConsumers = new Map();
for (const c of components) {
  for (const tName of componentAliases.get(c.name) || []) {
    if (!tokenConsumers.has(tName)) tokenConsumers.set(tName, new Set());
    tokenConsumers.get(tName).add(c.name);
  }
}

// --- Mode definitions ---
const MODES = {
  'comp-alias-raw': {
    headers: ['Components', 'Aliases (tokens used)', 'Raw values'],
    pivotItems: () => components.map((c) => c.name),
    pivotKind: 'component',
    col2Kind: 'token',
    col3Kind: 'token',
    showBindingFilter: true,
    pivotPlaceholder: 'Filter components…',
    expand(name) {
      const aliases = [...(componentAliases.get(name) || new Set())];
      const terminals = new Set();
      for (const a of aliases) for (const t of resolveTerminals(a)) if (t !== a) terminals.add(t);
      return { col2: aliases, col3: [...terminals] };
    },
  },
  'alias-comp': {
    headers: ['Aliases (tokens)', 'Components using', ''],
    pivotItems: () => allTokens.map((t) => t.name),
    pivotKind: 'token',
    col2Kind: 'component',
    col3Kind: null,
    showBindingFilter: false,
    pivotPlaceholder: 'Filter tokens…',
    expand(name) {
      return { col2: [...(tokenConsumers.get(name) || new Set())], col3: [] };
    },
  },
  'raw-alias': {
    headers: ['Raw values', 'Aliases resolving to it', ''],
    pivotItems: () => allTokens.filter((t) => (aliasOut.get(t.name) || []).length === 0).map((t) => t.name),
    pivotKind: 'token',
    col2Kind: 'token',
    col3Kind: null,
    showBindingFilter: false,
    pivotPlaceholder: 'Filter raw values…',
    expand(name) {
      return { col2: [...(aliasesResolvingTo.get(name) || new Set())], col3: [] };
    },
  },
};

// --- Cytoscape setup ---
const cy = cytoscape({
  container: document.getElementById('cy'),
  wheelSensitivity: 0.2,
  minZoom: 0.15,
  maxZoom: 2.5,
  style: [
    {
      selector: 'node',
      style: {
        'background-color': 'data(bg)',
        'border-color': 'data(border)',
        'border-width': 1,
        shape: 'round-rectangle',
        width: 'data(w)',
        height: 22,
        label: 'data(label)',
        color: '#e6e8ee',
        'font-size': 11,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'none',
        'text-margin-x': 'data(textMarginX)',
      },
    },
    {
      selector: 'node.selected',
      style: {
        'background-color': '#f3c33e',
        color: '#1a1a1a',
        'border-color': '#f3c33e',
        'font-weight': 'bold',
      },
    },
    {
      selector: 'edge',
      style: {
        'curve-style': 'unbundled-bezier',
        'control-point-distances': [-60, 60],
        'control-point-weights': [0.25, 0.75],
        'line-color': '#b04dd9',
        opacity: 0.7,
        width: 1.2,
        'target-arrow-shape': 'none',
        'source-endpoint': '90deg',
        'target-endpoint': '270deg',
      },
    },
    { selector: 'edge.shared', style: { 'line-color': '#f3c33e', opacity: 1, width: 2 } },
  ],
});

// --- Create all nodes once, hidden ---
// Approximate char width at 11px sans-serif. Used to compute a per-label
// text-margin-x that shifts the centered text into a left-aligned position.
const CHAR_W = 6.4;
const LEFT_PAD = 10;
function leftAlignMargin(label, nodeW) {
  const textW = label.length * CHAR_W;
  if (textW >= nodeW - LEFT_PAD * 2) return 0;
  return -(nodeW / 2 - LEFT_PAD - textW / 2);
}

for (const c of components) {
  const label = c.name;
  cy.add({
    data: {
      id: `c:${c.name}`,
      label,
      type: 'component',
      itemName: c.name,
      bg: '#1e222c',
      border: '#2a2f3a',
      w: NODE_W.component,
      textMarginX: leftAlignMargin(label, NODE_W.component),
      ref: c,
    },
    grabbable: false,
  });
}
for (const t of allTokens) {
  const label = formatTokenLabel(t);
  cy.add({
    data: {
      id: `t:${t.name}`,
      label,
      type: 'token',
      itemName: t.name,
      bg: '#3a1d4c',
      border: '#6b2e8c',
      w: NODE_W.token,
      textMarginX: leftAlignMargin(label, NODE_W.token),
    },
    grabbable: false,
  });
}
cy.nodes().style('display', 'none');

function formatTokenLabel(t) {
  const v = t.values?.default ?? '';
  return `${t.name}   ${v}`;
}

function nodeIdFor(kind, name) {
  return kind === 'component' ? `c:${name}` : `t:${name}`;
}

// --- State ---
let mode = 'comp-alias-raw';
const selected = new Set(); // pivot itemName values
let searchQuery = '';
let bindingFilter = 'all'; // 'all' | 'with' | 'without'

// --- Filter & visible pivot list ---
function passesBindingFilter(name) {
  if (mode !== 'comp-alias-raw' || bindingFilter === 'all') return true;
  const has = (componentAliases.get(name) || new Set()).size > 0;
  return bindingFilter === 'with' ? has : !has;
}

function visiblePivotItems() {
  const all = MODES[mode].pivotItems();
  return all.filter((name) => {
    if (!passesBindingFilter(name)) return false;
    if (!searchQuery) return true;
    return name.toLowerCase().includes(searchQuery);
  });
}

// --- Main render ---
function rerender() {
  const M = MODES[mode];
  cy.batch(() => {
    cy.edges().remove();
    cy.nodes().style('display', 'none');
    // Component nodes: keep .selected only when they are pivots and selected
    cy.nodes('node.selected').removeClass('selected');

    // Column 1: visible pivot items
    const pivots = visiblePivotItems();
    pivots.forEach((name, i) => {
      const id = nodeIdFor(M.pivotKind, name);
      const node = cy.getElementById(id);
      node.style('display', 'element');
      node.position({ x: COL_X[1], y: i * ROW_H });
      if (selected.has(name)) node.addClass('selected');
    });

    if (selected.size === 0) return;

    // Anchor Y from topmost selected pivot
    let anchorY = Infinity;
    for (const name of selected) {
      const n = cy.getElementById(nodeIdFor(M.pivotKind, name));
      if (n.length && n.style('display') !== 'none') anchorY = Math.min(anchorY, n.position('y'));
    }
    if (!isFinite(anchorY)) anchorY = 0;

    // Compute col2 union and col3 union
    const col2Sources = new Map(); // col2 item -> Set of pivots referencing it
    const col3Set = new Set();
    for (const sName of selected) {
      // Skip pivots that are filtered out
      const n = cy.getElementById(nodeIdFor(M.pivotKind, sName));
      if (!n.length || n.style('display') === 'none') continue;
      const { col2, col3 } = M.expand(sName);
      for (const x of col2) {
        if (!col2Sources.has(x)) col2Sources.set(x, new Set());
        col2Sources.get(x).add(sName);
      }
      for (const x of col3 || []) col3Set.add(x);
    }

    // Position col2
    const col2List = [...col2Sources.keys()].sort();
    col2List.forEach((name, i) => {
      const node = cy.getElementById(nodeIdFor(M.col2Kind, name));
      if (!node.length) return;
      node.style('display', 'element');
      node.position({ x: COL_X[2], y: anchorY + i * ROW_H });
    });

    // Position col3
    if (M.col3Kind) {
      const col3List = [...col3Set].sort();
      col3List.forEach((name, i) => {
        const node = cy.getElementById(nodeIdFor(M.col3Kind, name));
        if (!node.length) return;
        node.style('display', 'element');
        node.position({ x: COL_X[3], y: anchorY + i * ROW_H });
      });
    }

    // Edges: pivot -> col2
    let edgeId = 0;
    for (const [name, sources] of col2Sources.entries()) {
      const shared = sources.size > 1;
      for (const sName of sources) {
        cy.add({
          data: {
            id: `e${edgeId++}`,
            source: nodeIdFor(M.pivotKind, sName),
            target: nodeIdFor(M.col2Kind, name),
          },
          classes: shared ? 'shared' : '',
        });
      }
    }

    // Edges: col2 -> col3 (only in modes that have col3; mode 1 = alias→terminal)
    if (M.col3Kind && mode === 'comp-alias-raw') {
      for (const aliasName of col2List) {
        for (const term of resolveTerminals(aliasName)) {
          if (term === aliasName) continue;
          if (!col3Set.has(term)) continue;
          cy.add({
            data: {
              id: `e${edgeId++}`,
              source: nodeIdFor(M.col2Kind, aliasName),
              target: nodeIdFor(M.col3Kind, term),
            },
          });
        }
      }
    }
  });
  updateZoomLabel();
}

// --- Click dispatch ---
cy.on('tap', 'node', (evt) => {
  const node = evt.target;
  const M = MODES[mode];
  const itemName = node.data('itemName');
  const kind = node.data('type');
  // A node is a "pivot" if its kind matches the mode's pivotKind AND it's
  // currently positioned in column 1 (col2/col3 nodes are reused tokens).
  const x = node.position('x');
  const isPivotLane = Math.abs(x - COL_X[1]) < 1 && kind === M.pivotKind;
  if (isPivotLane) {
    if (selected.has(itemName)) selected.delete(itemName);
    else selected.add(itemName);
    rerender();
    renderDetails();
  } else {
    renderItemDetails(kind, itemName);
  }
});

cy.on('tap', (evt) => {
  if (evt.target === cy) {
    // Background tap: do nothing (keep selection)
  }
});

// --- UI handlers ---
document.getElementById('reset').addEventListener('click', () => {
  selected.clear();
  rerender();
  renderDetails();
});

document.querySelectorAll('#mode-switch button').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (mode === btn.dataset.mode) return;
    mode = btn.dataset.mode;
    selected.clear();
    document.querySelectorAll('#mode-switch button').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    });
    // Update lane headers
    const M = MODES[mode];
    document.getElementById('lane-1-header').textContent = M.headers[0];
    document.getElementById('lane-2-header').textContent = M.headers[1];
    document.getElementById('lane-3-header').textContent = M.headers[2] || '';
    document.getElementById('lane-3-header').style.display = M.col3Kind ? '' : 'none';
    // Show/hide binding filter
    document.getElementById('binding-filter').style.display = M.showBindingFilter ? '' : 'none';
    // Update search placeholder
    document.getElementById('search').placeholder = M.pivotPlaceholder;
    document.getElementById('search').value = '';
    searchQuery = '';
    renderDetails();
    rerender();
  });
});

document.getElementById('search').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  rerender();
});

document.querySelectorAll('#binding-filter button').forEach((btn) => {
  btn.addEventListener('click', () => {
    bindingFilter = btn.dataset.binding;
    document.querySelectorAll('#binding-filter button').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    });
    rerender();
  });
});

// --- Zoom controls ---
function resetView() {
  cy.zoom(1);
  cy.pan({ x: 40 + NODE_W.component / 2, y: 60 });
  updateZoomLabel();
}
function updateZoomLabel() {
  const el = document.getElementById('zoom-level');
  if (el) el.textContent = `${Math.round(cy.zoom() * 100)}%`;
}
function zoomBy(factor) {
  const z = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
  const w = cy.width(), h = cy.height();
  cy.zoom({ level: z, renderedPosition: { x: w / 2, y: h / 2 } });
  updateZoomLabel();
}
document.getElementById('zoom-in').addEventListener('click', () => zoomBy(1.2));
document.getElementById('zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
document.getElementById('zoom-level').addEventListener('click', resetView);
cy.on('zoom pan', updateZoomLabel);

// --- Details pane ---
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDetails() {
  const body = document.getElementById('details-body');
  if (selected.size === 0) {
    const M = MODES[mode];
    const noun = M.pivotKind === 'component' ? 'component' : (mode === 'raw-alias' ? 'raw value' : 'token');
    body.innerHTML = `<em>Click a ${noun} to expand.</em>`;
    return;
  }
  const M = MODES[mode];
  const parts = [];
  for (const name of selected) {
    parts.push(detailsHtml(M.pivotKind, name));
  }
  body.innerHTML = parts.join('');
}

function renderItemDetails(kind, name) {
  document.getElementById('details-body').innerHTML = detailsHtml(kind, name);
}

function detailsHtml(kind, name) {
  if (kind === 'component') {
    const c = components.find((x) => x.name === name);
    if (!c) return '';
    return `
      <div class="section">
        <dl class="kv">
          <dt>Selector</dt><dd><code>${escapeHtml(c.name)}</code></dd>
          <dt>Class</dt><dd><code>${escapeHtml(c.className)}</code></dd>
          <dt>Path</dt><dd><code>${escapeHtml(c.path)}</code></dd>
        </dl>
        <h2>Bindings (${c.tokenBindings.length})</h2>
        ${
          c.tokenBindings
            .map(
              (b) =>
                `<div class="binding"><span class="ctx">${escapeHtml(b.context)}</span><div><code>$${escapeHtml(b.token)}</code><div class="sel">${escapeHtml(b.selector)}</div></div></div>`,
            )
            .join('') || '<em>No bindings.</em>'
        }
      </div>`;
  }
  const t = tokenByName.get(name);
  if (!t) return '';
  const val = t.values?.default ?? '';
  const swatch = t.type === 'color' && /^#|^rgb|^hsl/.test(val) ? `<span class="swatch" style="background:${escapeHtml(val)}"></span>` : '';
  const terms = [...resolveTerminals(name)];
  const consumers = [...(tokenConsumers.get(name) || new Set())];
  return `
    <div class="section">
      <dl class="kv">
        <dt>Token</dt><dd><code>$${escapeHtml(name)}</code></dd>
        <dt>Value</dt><dd>${swatch}<code>${escapeHtml(val)}</code></dd>
        <dt>Type</dt><dd>${escapeHtml(t.type)}</dd>
        <dt>Category</dt><dd>${escapeHtml(t.category)}</dd>
        <dt>Declared</dt><dd><code>${escapeHtml(t.declaredIn)}</code></dd>
        <dt>Resolves to</dt><dd>${terms.map((x) => `<code>$${escapeHtml(x)}</code>`).join(', ')}</dd>
      </dl>
      <h2>Used directly by (${consumers.length})</h2>
      ${consumers.slice(0, 50).map((c) => `<div>${escapeHtml(c)}</div>`).join('') || '<em>No components.</em>'}
      ${consumers.length > 50 ? `<div><em>… ${consumers.length - 50} more</em></div>` : ''}
    </div>`;
}

// --- Stats ---
document.getElementById('stats').textContent = `${components.length} components · ${dataset.tokens.length} tokens`;

// --- Init ---
resetView();
rerender();

// debug
window.cy = cy;
window.dataset = dataset;
