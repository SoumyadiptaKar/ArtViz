const API_BASE = window.__API_BASE__ || (window.location.port === '8000' ? 'http://localhost:3001' : '/api');

const dom = {
  statusText: document.getElementById('statusText'),
  searchInput: document.getElementById('searchInput'),
  themeSelect: document.getElementById('themeSelect'),
  renderingSelect: document.getElementById('renderingSelect'),
  materialSelect: document.getElementById('materialSelect'),
  shapeSelect: document.getElementById('shapeSelect'),
  deltaEInput: document.getElementById('deltaEInput'),
  searchButton: document.getElementById('searchButton'),
  weightSlider: document.getElementById('weightSlider'),
  weightValue: document.getElementById('weightValue'),
  transformButton: document.getElementById('transformButton'),
  networkCanvas: document.getElementById('networkCanvas'),
  heatmap: document.getElementById('heatmap'),
  currentNodeBox: document.getElementById('currentNodeBox'),
  degreeBars: document.getElementById('degreeBars'),
  eigenBars: document.getElementById('eigenBars'),
  spaceCanvas: document.getElementById('spaceCanvas'),
  spaceInfo: document.getElementById('spaceInfo'),
  spaceButtons: Array.from(document.querySelectorAll('.space-btn')),
  sankeyCanvas: document.getElementById('sankeyCanvas'),
  rInput: document.getElementById('rInput'),
  gInput: document.getElementById('gInput'),
  bInput: document.getElementById('bInput'),
  colorSearchButton: document.getElementById('colorSearchButton'),
  treeCanvas: document.getElementById('treeCanvas'),
  treemapCanvas: document.getElementById('treemapCanvas'),
  paintingList: document.getElementById('paintingList'),
};

const state = {
  rawArtworks: [],
  filteredArtworks: [],
  clusters: [],
  paintNodes: [],
  colorNodes: [],
  bipartiteEdges: [],
  oneModeLinks: [],
  oneModeAdj: new Map(),
  centrality: new Map(),
  mode: 'one-mode',
  selectedColorIds: [],
  currentNodeId: null,
  spaceMode: 'rgb',
  scatterPoints: [],
  nodeById: new Map(),
  artworkById: new Map(),
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeHex(hex) {
  const raw = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

function hexToRgb(hex) {
  const clean = normalizeHex(hex);
  if (!clean) return null;
  return {
    r: Number.parseInt(clean.slice(1, 3), 16),
    g: Number.parseInt(clean.slice(3, 5), 16),
    b: Number.parseInt(clean.slice(5, 7), 16),
  };
}

function rgbToHex(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function srgbToLinear(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function rgbToXyz(rgb) {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    z: r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  };
}

function xyzToLab(xyz) {
  const ref = { x: 0.95047, y: 1.0, z: 1.08883 };
  const t = {
    x: xyz.x / ref.x,
    y: xyz.y / ref.y,
    z: xyz.z / ref.z,
  };

  const f = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = f(t.x);
  const fy = f(t.y);
  const fz = f(t.z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb));
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

function deltaE2000(lab1, lab2) {
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const c1 = Math.hypot(lab1.a, lab1.b);
  const c2 = Math.hypot(lab2.a, lab2.b);
  const cAvg = (c1 + c2) / 2;

  const cAvg7 = cAvg ** 7;
  const g = 0.5 * (1 - Math.sqrt(cAvg7 / (cAvg7 + 25 ** 7 || 1)));

  const a1Prime = (1 + g) * lab1.a;
  const a2Prime = (1 + g) * lab2.a;

  const c1Prime = Math.hypot(a1Prime, lab1.b);
  const c2Prime = Math.hypot(a2Prime, lab2.b);

  const h1Prime = (radToDeg(Math.atan2(lab1.b, a1Prime)) + 360) % 360;
  const h2Prime = (radToDeg(Math.atan2(lab2.b, a2Prime)) + 360) % 360;

  const dLPrime = lab2.l - lab1.l;
  const dCPrime = c2Prime - c1Prime;

  let dhPrime = 0;
  if (c1Prime * c2Prime !== 0) {
    dhPrime = h2Prime - h1Prime;
    if (dhPrime > 180) dhPrime -= 360;
    if (dhPrime < -180) dhPrime += 360;
  }

  const dHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(degToRad(dhPrime / 2));

  const lPrimeAvg = (lab1.l + lab2.l) / 2;
  const cPrimeAvg = (c1Prime + c2Prime) / 2;

  let hPrimeAvg = h1Prime + h2Prime;
  if (c1Prime * c2Prime !== 0) {
    if (Math.abs(h1Prime - h2Prime) > 180) hPrimeAvg += 360;
    hPrimeAvg /= 2;
  }

  const t =
    1 -
    0.17 * Math.cos(degToRad(hPrimeAvg - 30)) +
    0.24 * Math.cos(degToRad(2 * hPrimeAvg)) +
    0.32 * Math.cos(degToRad(3 * hPrimeAvg + 6)) -
    0.2 * Math.cos(degToRad(4 * hPrimeAvg - 63));

  const dTheta = 30 * Math.exp(-(((hPrimeAvg - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt((cPrimeAvg ** 7) / (cPrimeAvg ** 7 + 25 ** 7 || 1));

  const sL = 1 + (0.015 * (lPrimeAvg - 50) ** 2) / Math.sqrt(20 + (lPrimeAvg - 50) ** 2);
  const sC = 1 + 0.045 * cPrimeAvg;
  const sH = 1 + 0.015 * cPrimeAvg * t;

  const rT = -Math.sin(degToRad(2 * dTheta)) * rC;

  const lTerm = dLPrime / (kL * sL);
  const cTerm = dCPrime / (kC * sC);
  const hTerm = dHPrime / (kH * sH);

  return Math.sqrt(lTerm * lTerm + cTerm * cTerm + hTerm * hTerm + rT * cTerm * hTerm);
}

function rgbToHsv(rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;

  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return {
    h,
    s: max === 0 ? 0 : (d / max) * 100,
    v: max * 100,
  };
}

function classifyArtwork(artwork) {
  const keywords = (artwork.keywords || []).map((v) => String(v).toLowerCase());
  const materials = (artwork.materials || []).map((v) => String(v).toLowerCase());
  const classes = (artwork.classifications || []).map((v) => String(v).toLowerCase());

  const theme = keywords[0] || classes[0] || 'unknown';
  let rendering = 'mixed';
  if (materials.some((m) => m.includes('ink'))) rendering = 'ink wash';
  else if (materials.some((m) => m.includes('oil'))) rendering = 'heavy coloring';
  else if (materials.some((m) => m.includes('watercolor'))) rendering = 'watercolor';

  const material = materials[0] || 'unknown';
  const shape = classes[0] || 'painting';
  const year = Number(artwork.timeline?.yearFrom || artwork.timeline?.acquisitionYear || 0);
  const dynasty = year ? (year < 1700 ? 'pre-1700' : year < 1800 ? '1700s' : year < 1900 ? '1800s' : year < 2000 ? '1900s' : '2000s') : 'unknown';

  return { theme, rendering, material, shape, dynasty };
}

function setStatus(message) {
  dom.statusText.textContent = message;
}

async function fetchArtworks() {
  const loadWithLimit = async (limit) => {
    const params = new URLSearchParams({
      includePalette: 'true',
      limit: String(limit),
    });

    const response = await fetch(`${API_BASE}/api/artworks?${params.toString()}`);
    if (!response.ok) throw new Error(`Failed to load artworks: ${response.status}`);
    return response.json();
  };

  let payload;
  try {
    payload = await loadWithLimit(320);
  } catch (error) {
    // Fall back to a smaller sample if the backend is under load.
    payload = await loadWithLimit(180);
  }

  const items = Array.isArray(payload.items) ? payload.items : [];

  const enriched = items
    .filter((art) => Array.isArray(art.palette) && art.palette.length)
    .map((art) => ({
      ...art,
      attributes: classifyArtwork(art),
    }));

  state.rawArtworks = enriched;
  state.artworkById = new Map(enriched.map((art) => [art.id, art]));
}

function populateFilterOptions() {
  const sets = {
    theme: new Set(),
    rendering: new Set(),
    material: new Set(),
    shape: new Set(),
  };

  for (const art of state.rawArtworks) {
    sets.theme.add(art.attributes.theme);
    sets.rendering.add(art.attributes.rendering);
    sets.material.add(art.attributes.material);
    sets.shape.add(art.attributes.shape);
  }

  const inject = (select, values) => {
    const current = select.value;
    select.innerHTML = '<option value="">All</option>';
    values
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 120)
      .forEach((value) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
      });
    if (current) select.value = current;
  };

  inject(dom.themeSelect, [...sets.theme]);
  inject(dom.renderingSelect, [...sets.rendering]);
  inject(dom.materialSelect, [...sets.material]);
  inject(dom.shapeSelect, [...sets.shape]);
}

function applyScopeFilters() {
  const term = dom.searchInput.value.trim().toLowerCase();
  const theme = dom.themeSelect.value;
  const rendering = dom.renderingSelect.value;
  const material = dom.materialSelect.value;
  const shape = dom.shapeSelect.value;

  state.filteredArtworks = state.rawArtworks.filter((art) => {
    if (theme && art.attributes.theme !== theme) return false;
    if (rendering && art.attributes.rendering !== rendering) return false;
    if (material && art.attributes.material !== material) return false;
    if (shape && art.attributes.shape !== shape) return false;

    if (term) {
      const text = [
        art.title,
        ...(art.artistNames || []),
        ...(art.keywords || []),
        ...(art.materials || []),
      ]
        .join(' ')
        .toLowerCase();
      if (!text.includes(term)) return false;
    }

    return true;
  });
}

function buildMergedColorNodes(deltaE) {
  const samples = [];
  for (const artwork of state.filteredArtworks) {
    for (const entry of artwork.palette || []) {
      const rgb = Array.isArray(entry.rgb)
        ? { r: entry.rgb[0], g: entry.rgb[1], b: entry.rgb[2] }
        : hexToRgb(entry.hex);
      if (!rgb) continue;
      const ratio = Number(entry.ratio || 0.2);
      if (ratio < 0.0005 || ratio > 0.8) continue;
      samples.push({
        artworkId: artwork.id,
        title: artwork.title,
        rgb,
        lab: rgbToLab(rgb),
        ratio,
      });
    }
  }

  const clusters = [];

  for (const sample of samples) {
    let matched = null;
    for (const cluster of clusters) {
      if (deltaE2000(sample.lab, cluster.labAvg) <= deltaE) {
        matched = cluster;
        break;
      }
    }

    if (!matched) {
      matched = {
        id: `C${clusters.length + 1}`,
        count: 0,
        ratioSum: 0,
        rgbAcc: { r: 0, g: 0, b: 0 },
        labAcc: { l: 0, a: 0, b: 0 },
        labAvg: { ...sample.lab },
        artworkIds: new Set(),
      };
      clusters.push(matched);
    }

    matched.count += 1;
    matched.ratioSum += sample.ratio;
    matched.rgbAcc.r += sample.rgb.r;
    matched.rgbAcc.g += sample.rgb.g;
    matched.rgbAcc.b += sample.rgb.b;
    matched.labAcc.l += sample.lab.l;
    matched.labAcc.a += sample.lab.a;
    matched.labAcc.b += sample.lab.b;
    matched.artworkIds.add(sample.artworkId);

    matched.labAvg = {
      l: matched.labAcc.l / matched.count,
      a: matched.labAcc.a / matched.count,
      b: matched.labAcc.b / matched.count,
    };
  }

  const limited = clusters
    .map((c) => {
      const rgb = {
        r: c.rgbAcc.r / c.count,
        g: c.rgbAcc.g / c.count,
        b: c.rgbAcc.b / c.count,
      };

      return {
        id: c.id,
        label: c.id,
        count: c.count,
        ratioSum: c.ratioSum,
        rgb,
        lab: c.labAvg,
        hex: rgbToHex(rgb),
        artworkIds: c.artworkIds,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 90);

  state.colorNodes = limited;
  state.nodeById = new Map(limited.map((n) => [n.id, n]));
}

function buildBipartite() {
  const colorIdSet = new Set(state.colorNodes.map((n) => n.id));
  const colorByLab = state.colorNodes;
  const edges = [];
  const paintNodes = [];

  for (const art of state.filteredArtworks) {
    const colorIds = new Set();
    for (const entry of art.palette || []) {
      const rgb = Array.isArray(entry.rgb)
        ? { r: entry.rgb[0], g: entry.rgb[1], b: entry.rgb[2] }
        : hexToRgb(entry.hex);
      if (!rgb) continue;
      const lab = rgbToLab(rgb);

      let best = null;
      let bestDist = Infinity;
      for (const node of colorByLab) {
        if (!colorIdSet.has(node.id)) continue;
        const dist = deltaE2000(lab, node.lab);
        if (dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      }
      if (best) colorIds.add(best.id);
    }

    if (!colorIds.size) continue;

    paintNodes.push({
      id: `P_${art.id}`,
      artworkId: art.id,
      label: art.title,
      type: 'painting',
    });

    for (const colorId of colorIds) {
      edges.push({ source: `P_${art.id}`, target: colorId, weight: 1 });
    }
  }

  state.paintNodes = paintNodes;
  state.bipartiteEdges = edges;
}

function buildOneMode(weightThreshold) {
  const colorToPaintings = new Map(state.colorNodes.map((c) => [c.id, new Set()]));

  for (const edge of state.bipartiteEdges) {
    if (!colorToPaintings.has(edge.target)) continue;
    colorToPaintings.get(edge.target).add(edge.source);
  }

  const links = [];
  const nodes = state.colorNodes;

  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    const setA = colorToPaintings.get(a.id) || new Set();
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const setB = colorToPaintings.get(b.id) || new Set();

      let inter = 0;
      for (const id of setA) {
        if (setB.has(id)) inter += 1;
      }
      if (!inter) continue;

      const similarity = inter / Math.sqrt(setA.size * setB.size);
      if (similarity < weightThreshold) continue;

      links.push({
        source: a.id,
        target: b.id,
        similarity,
      });
    }
  }

  state.oneModeLinks = links;
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const link of links) {
    adj.get(link.source).push({ id: link.target, w: link.similarity });
    adj.get(link.target).push({ id: link.source, w: link.similarity });
  }
  state.oneModeAdj = adj;
}

function computeCentrality() {
  const nodes = state.colorNodes;
  const adj = state.oneModeAdj;
  const n = nodes.length || 1;
  const idx = new Map(nodes.map((node, i) => [node.id, i]));

  const degree = new Map(nodes.map((node) => [node.id, (adj.get(node.id)?.length || 0) / Math.max(1, n - 1)]));

  const vec = new Array(n).fill(1 / n);
  for (let iter = 0; iter < 40; iter += 1) {
    const next = new Array(n).fill(0);
    for (const node of nodes) {
      const i = idx.get(node.id);
      for (const nb of adj.get(node.id) || []) {
        const j = idx.get(nb.id);
        next[i] += vec[j] * nb.w;
      }
    }
    const norm = Math.hypot(...next) || 1;
    for (let i = 0; i < n; i += 1) vec[i] = next[i] / norm;
  }
  const eigen = new Map(nodes.map((node) => [node.id, vec[idx.get(node.id)]]));

  const betweenness = new Map(nodes.map((node) => [node.id, 0]));
  for (const s of nodes) {
    const S = [];
    const P = new Map(nodes.map((v) => [v.id, []]));
    const sigma = new Map(nodes.map((v) => [v.id, 0]));
    const dist = new Map(nodes.map((v) => [v.id, -1]));

    sigma.set(s.id, 1);
    dist.set(s.id, 0);
    const Q = [s.id];

    while (Q.length) {
      const v = Q.shift();
      S.push(v);
      for (const nb of adj.get(v) || []) {
        if (dist.get(nb.id) < 0) {
          Q.push(nb.id);
          dist.set(nb.id, dist.get(v) + 1);
        }
        if (dist.get(nb.id) === dist.get(v) + 1) {
          sigma.set(nb.id, sigma.get(nb.id) + sigma.get(v));
          P.get(nb.id).push(v);
        }
      }
    }

    const delta = new Map(nodes.map((v) => [v.id, 0]));
    while (S.length) {
      const w = S.pop();
      for (const v of P.get(w)) {
        const denom = sigma.get(w) || 1;
        const value = delta.get(v) + (sigma.get(v) / denom) * (1 + delta.get(w));
        delta.set(v, value);
      }
      if (w !== s.id) {
        betweenness.set(w, betweenness.get(w) + delta.get(w));
      }
    }
  }

  const closeness = new Map();
  for (const node of nodes) {
    const distances = new Map(nodes.map((n2) => [n2.id, -1]));
    distances.set(node.id, 0);
    const queue = [node.id];

    while (queue.length) {
      const v = queue.shift();
      for (const nb of adj.get(v) || []) {
        if (distances.get(nb.id) >= 0) continue;
        distances.set(nb.id, distances.get(v) + 1);
        queue.push(nb.id);
      }
    }

    let sum = 0;
    let count = 0;
    for (const d of distances.values()) {
      if (d > 0) {
        sum += d;
        count += 1;
      }
    }
    closeness.set(node.id, count && sum ? count / sum : 0);
  }

  const maxEigen = Math.max(...eigen.values(), 1);
  const maxBC = Math.max(...betweenness.values(), 1);

  state.centrality = new Map(
    nodes.map((node) => [
      node.id,
      {
        degree: degree.get(node.id) || 0,
        eigen: (eigen.get(node.id) || 0) / maxEigen,
        bc: (betweenness.get(node.id) || 0) / maxBC,
        closeness: closeness.get(node.id) || 0,
      },
    ])
  );
}

function renderBars() {
  const rows = state.colorNodes
    .map((node) => ({
      id: node.id,
      hex: node.hex,
      degree: state.centrality.get(node.id)?.degree || 0,
      eigen: state.centrality.get(node.id)?.eigen || 0,
    }))
    .sort((a, b) => b.degree - a.degree);

  const degreeTop = rows.slice(0, 15);
  const eigenTop = [...rows].sort((a, b) => b.eigen - a.eigen).slice(0, 15);

  const renderSet = (root, items, key) => {
    root.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span>${item.id}</span><div class="bar" style="width:${Math.max(8, item[key] * 100)}%;background:${item.hex}"></div>`;
      root.appendChild(row);
    }
  };

  renderSet(dom.degreeBars, degreeTop, 'degree');
  renderSet(dom.eigenBars, eigenTop, 'eigen');
}

function renderCurrentNode(nodeId) {
  const node = state.nodeById.get(nodeId);
  if (!node) {
    dom.currentNodeBox.innerHTML = '<p>Click a color node to inspect centrality metrics.</p>';
    return;
  }

  const c = state.centrality.get(nodeId) || { degree: 0, bc: 0, closeness: 0, eigen: 0 };

  dom.currentNodeBox.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="color-dot" style="width:22px;height:22px;background:${node.hex}"></span>
      <strong>${node.id}</strong>
      <span>${node.hex}</span>
    </div>
    <p>R:${Math.round(node.rgb.r)} G:${Math.round(node.rgb.g)} B:${Math.round(node.rgb.b)}</p>
    <p>Degree: ${c.degree.toFixed(3)}</p>
    <p>BC: ${c.bc.toFixed(3)} | CC: ${c.closeness.toFixed(3)} | EC: ${c.eigen.toFixed(3)}</p>
  `;
}

function computeSimilarityMap() {
  const map = new Map();
  for (const link of state.oneModeLinks) {
    map.set(`${link.source}|${link.target}`, link.similarity);
    map.set(`${link.target}|${link.source}`, link.similarity);
  }
  return map;
}

function renderHeatmap() {
  if (!state.selectedColorIds.length) {
    dom.heatmap.innerHTML = '<p style="font-size:0.78rem;color:#76674f;">Select color nodes to populate the matrix.</p>';
    return;
  }

  const sim = computeSimilarityMap();
  const selected = state.selectedColorIds.map((id) => state.nodeById.get(id)).filter(Boolean);

  const topCols = new Set();
  for (const row of selected) {
    const candidates = state.colorNodes
      .filter((node) => node.id !== row.id)
      .map((node) => ({ node, score: sim.get(`${row.id}|${node.id}`) || 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);

    for (const c of candidates) topCols.add(c.node.id);
  }

  const colIds = Array.from(topCols).slice(0, 15);
  const colNodes = colIds.map((id) => state.nodeById.get(id)).filter(Boolean);

  let html = '<table><thead><tr><th></th>';
  for (const col of colNodes) {
    html += `<th><span class="color-dot" style="background:${col.hex}"></span></th>`;
  }
  html += '</tr></thead><tbody>';

  for (const row of selected) {
    html += `<tr><th><span class="color-dot" style="background:${row.hex}"></span></th>`;
    for (const col of colNodes) {
      const value = sim.get(`${row.id}|${col.id}`) || 0;
      html += `<td>${value.toFixed(2)}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  dom.heatmap.innerHTML = html;
}

function makeNetworkNodesAndLinks() {
  if (state.mode === 'bipartite') {
    const colorNodes = state.colorNodes.map((node) => ({
      id: node.id,
      label: node.id,
      hex: node.hex,
      type: 'color',
      size: 4 + Math.sqrt(node.count),
    }));

    const paintNodes = state.paintNodes.slice(0, 180).map((node) => ({
      id: node.id,
      label: node.label,
      type: 'painting',
      size: 4,
    }));

    const paintIds = new Set(paintNodes.map((n) => n.id));
    const links = state.bipartiteEdges.filter((e) => paintIds.has(e.source));

    return {
      nodes: [...paintNodes, ...colorNodes],
      links,
    };
  }

  return {
    nodes: state.colorNodes.map((node) => ({
      id: node.id,
      label: node.id,
      hex: node.hex,
      type: 'color',
      size: 4 + Math.sqrt(node.count),
    })),
    links: state.oneModeLinks.map((link) => ({
      source: link.source,
      target: link.target,
      weight: link.similarity,
    })),
  };
}

function renderNetwork() {
  const { nodes, links } = makeNetworkNodesAndLinks();
  dom.networkCanvas.innerHTML = '';

  if (!nodes.length) {
    dom.networkCanvas.innerHTML = '<p style="padding:12px;color:#76674f;">No nodes for this scope.</p>';
    return;
  }

  const width = Math.max(620, dom.networkCanvas.clientWidth || 620);
  const height = Math.max(420, dom.networkCanvas.clientHeight || 420);

  const svg = d3
    .select(dom.networkCanvas)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const g = svg.append('g');

  svg.call(
    d3.zoom().scaleExtent([0.35, 4]).on('zoom', (event) => {
      g.attr('transform', event.transform);
    })
  );

  const linkSel = g
    .append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', '#8f8778')
    .attr('stroke-opacity', (d) => (state.mode === 'one-mode' ? 0.15 + d.weight * 0.6 : 0.22))
    .attr('stroke-width', (d) => (state.mode === 'one-mode' ? Math.max(0.4, d.weight * 4) : 0.6));

  const nodeSel = g
    .append('g')
    .selectAll('circle')
    .data(nodes)
    .join((enter) => {
      const cg = enter.append('g');
      cg.each(function setup(d) {
        if (d.type === 'painting') {
          d3.select(this)
            .append('rect')
            .attr('x', -4)
            .attr('y', -4)
            .attr('width', 8)
            .attr('height', 8)
            .attr('rx', 1)
            .attr('fill', '#8f8573')
            .attr('stroke', '#4e473f')
            .attr('stroke-width', 0.6);
        } else {
          d3.select(this)
            .append('circle')
            .attr('r', d.size)
            .attr('fill', d.hex)
            .attr('stroke', '#fff')
            .attr('stroke-width', 0.9);
        }
      });
      return cg;
    })
    .style('cursor', 'pointer')
    .on('click', (_, d) => {
      if (d.type !== 'color') return;
      state.currentNodeId = d.id;
      if (!state.selectedColorIds.includes(d.id)) {
        state.selectedColorIds = [...state.selectedColorIds.slice(-5), d.id];
      }
      renderCurrentNode(d.id);
      renderHeatmap();
      renderColorSearchFromExisting(d.id);
    });

  nodeSel.append('title').text((d) => (d.type === 'color' ? `${d.label}` : d.label));

  const simulation = d3
    .forceSimulation(nodes)
    .force('charge', d3.forceManyBody().strength(state.mode === 'one-mode' ? -38 : -22))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius((d) => (d.type === 'color' ? d.size + 1.8 : 6)));

  if (links.length) {
    simulation.force(
      'link',
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance((d) => {
          if (state.mode === 'one-mode') return 140 - d.weight * 100;
          return 72;
        })
        .strength((d) => (state.mode === 'one-mode' ? 0.1 + d.weight * 0.6 : 0.22))
    );
  }

  if (state.mode === 'bipartite') {
    simulation.force(
      'x',
      d3
        .forceX((d) => (d.type === 'painting' ? width * 0.3 : width * 0.72))
        .strength(0.12)
    );
  }

  nodeSel.call(
    d3
      .drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.2).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      })
  );

  simulation.on('tick', () => {
    linkSel
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    nodeSel.attr('transform', (d) => `translate(${d.x}, ${d.y})`);
  });
}

function toSpaceVector(rgb, mode) {
  if (mode === 'rgb') return { x: rgb.r, y: rgb.g, z: rgb.b };
  if (mode === 'hsv') {
    const hsv = rgbToHsv(rgb);
    return { x: hsv.h / 360 * 255, y: hsv.s / 100 * 255, z: hsv.v / 100 * 255 };
  }

  const lab = rgbToLab(rgb);
  return {
    x: (lab.a + 128) / 255 * 255,
    y: lab.l / 100 * 255,
    z: (lab.b + 128) / 255 * 255,
  };
}

function renderColorSpace() {
  const canvas = dom.spaceCanvas;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const sample = [];
  for (const art of state.filteredArtworks.slice(0, 220)) {
    for (const entry of art.palette || []) {
      const rgb = Array.isArray(entry.rgb)
        ? { r: entry.rgb[0], g: entry.rgb[1], b: entry.rgb[2] }
        : hexToRgb(entry.hex);
      if (!rgb) continue;
      sample.push({ artworkId: art.id, title: art.title, rgb });
    }
  }

  const points = sample.map((s) => {
    const v = toSpaceVector(s.rgb, state.spaceMode);
    const sx = 40 + v.x * 0.78 - v.y * 0.36;
    const sy = height - 24 - v.z * 0.63 - v.y * 0.24;
    return {
      ...s,
      vector: v,
      sx,
      sy,
    };
  });

  state.scatterPoints = points;

  ctx.strokeStyle = '#c8b087';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, height - 20);
  ctx.lineTo(width - 24, height - 20);
  ctx.moveTo(40, height - 20);
  ctx.lineTo(40, 18);
  ctx.moveTo(40, height - 20);
  ctx.lineTo(112, 34);
  ctx.stroke();

  for (const p of points) {
    ctx.fillStyle = rgbToHex(p.rgb);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderSankey() {
  const host = dom.sankeyCanvas;
  host.innerHTML = '';

  const width = Math.max(680, host.clientWidth || 680);
  const height = Math.max(220, host.clientHeight || 220);

  const themes = new Map();
  const colors = new Map();
  const renderings = new Map();
  const dynasties = new Map();

  const getKey = (prefix, value) => `${prefix}:${value}`;
  const addFlow = (map, a, b, value) => {
    const key = `${a}|${b}`;
    map.set(key, (map.get(key) || 0) + value);
  };

  const flow1 = new Map();
  const flow2 = new Map();
  const flow3 = new Map();

  for (const art of state.filteredArtworks.slice(0, 260)) {
    const attr = art.attributes;
    const mainColor = (art.palette || [])[0];
    const hex = normalizeHex(mainColor?.hex) || '#999999';

    const t = getKey('t', attr.theme);
    const c = getKey('c', hex);
    const r = getKey('r', attr.rendering);
    const d = getKey('d', attr.dynasty);

    themes.set(t, attr.theme);
    colors.set(c, hex);
    renderings.set(r, attr.rendering);
    dynasties.set(d, attr.dynasty);

    addFlow(flow1, t, c, 1);
    addFlow(flow2, c, r, 1);
    addFlow(flow3, r, d, 1);
  }

  const nodeIds = [...themes.keys(), ...colors.keys(), ...renderings.keys(), ...dynasties.keys()];
  const nodes = nodeIds.map((id) => ({ id, name: id.split(':')[1] }));
  const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));

  const links = [];
  for (const [key, value] of [...flow1.entries(), ...flow2.entries(), ...flow3.entries()]) {
    const [a, b] = key.split('|');
    links.push({ source: nodeIndex.get(a), target: nodeIndex.get(b), value, from: a, to: b });
  }

  const svg = d3.select(host).append('svg').attr('width', width).attr('height', height);

  const sankey = d3
    .sankey()
    .nodeWidth(12)
    .nodePadding(9)
    .extent([
      [8, 10],
      [width - 8, height - 10],
    ]);

  const graph = sankey({ nodes: nodes.map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) });

  svg
    .append('g')
    .selectAll('path')
    .data(graph.links)
    .join('path')
    .attr('d', d3.sankeyLinkHorizontal())
    .attr('fill', 'none')
    .attr('stroke', (d) => {
      if (String(d.from).startsWith('c:')) return d.from.split(':')[1];
      if (String(d.to).startsWith('c:')) return d.to.split(':')[1];
      return '#9d988f';
    })
    .attr('stroke-width', (d) => Math.max(1, d.width))
    .attr('stroke-opacity', 0.55);

  const node = svg
    .append('g')
    .selectAll('rect')
    .data(graph.nodes)
    .join('rect')
    .attr('x', (d) => d.x0)
    .attr('y', (d) => d.y0)
    .attr('height', (d) => Math.max(1, d.y1 - d.y0))
    .attr('width', (d) => d.x1 - d.x0)
    .attr('fill', (d) => (String(d.id).startsWith('c:') ? d.id.split(':')[1] : '#b4a68b'))
    .attr('stroke', '#75664d')
    .attr('stroke-width', 0.6);

  node.append('title').text((d) => d.name);

  svg
    .append('g')
    .selectAll('text')
    .data(graph.nodes)
    .join('text')
    .attr('x', (d) => d.x0 - 4)
    .attr('y', (d) => (d.y0 + d.y1) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .attr('font-size', 10)
    .attr('fill', '#5e5038')
    .text((d) => String(d.name).slice(0, 16))
    .filter((d) => d.x0 < width / 2)
    .attr('x', (d) => d.x1 + 4)
    .attr('text-anchor', 'start');
}

function createTreeFromRoot(rootNode) {
  if (!rootNode) return null;

  const used = new Set([rootNode.id]);

  const distanceTo = (a, b) => deltaE2000(a.lab, b.lab);

  const level1 = state.colorNodes
    .filter((n) => n.id !== rootNode.id)
    .map((n) => ({ node: n, d: distanceTo(rootNode, n) }))
    .filter((v) => v.d < 10)
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map((v) => v.node);

  for (const n of level1) used.add(n.id);

  const children = level1.map((lv1) => {
    const level2 = state.colorNodes
      .filter((n) => !used.has(n.id))
      .map((n) => ({ node: n, d: distanceTo(lv1, n) }))
      .filter((v) => v.d < 10)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((v) => {
        used.add(v.node.id);
        return {
          name: v.node.id,
          color: v.node.hex,
          nodeId: v.node.id,
          children: [],
        };
      });

    return {
      name: lv1.id,
      color: lv1.hex,
      nodeId: lv1.id,
      children: level2,
    };
  });

  return {
    name: rootNode.id,
    color: rootNode.hex,
    nodeId: rootNode.id,
    children,
  };
}

function renderTree(treeData) {
  dom.treeCanvas.innerHTML = '';
  if (!treeData) {
    dom.treeCanvas.innerHTML = '<p style="padding:8px;color:#76674f;">No nearby colors for this query.</p>';
    return;
  }

  const width = Math.max(260, dom.treeCanvas.clientWidth || 260);
  const height = Math.max(190, dom.treeCanvas.clientHeight || 190);

  const svg = d3.select(dom.treeCanvas).append('svg').attr('width', width).attr('height', height);

  const root = d3.hierarchy(treeData);
  const tree = d3.tree().size([2 * Math.PI, Math.min(width, height) / 2 - 20]);
  tree(root);

  const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);

  g.append('g')
    .selectAll('path')
    .data(root.links())
    .join('path')
    .attr('d', d3.linkRadial().angle((d) => d.x).radius((d) => d.y))
    .attr('fill', 'none')
    .attr('stroke', '#9a9384')
    .attr('stroke-width', 1);

  const node = g
    .append('g')
    .selectAll('g')
    .data(root.descendants())
    .join('g')
    .attr('transform', (d) => `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y},0)`)
    .style('cursor', 'pointer')
    .on('click', (_, d) => {
      renderNodeTreemap(d.data.nodeId);
      renderPaintingList(d.data.nodeId);
      renderCurrentNode(d.data.nodeId);
    });

  node
    .append('circle')
    .attr('r', 5)
    .attr('fill', (d) => d.data.color)
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.2);

  node
    .append('text')
    .attr('dy', '0.31em')
    .attr('x', (d) => (d.x < Math.PI === !d.children ? 8 : -8))
    .attr('text-anchor', (d) => (d.x < Math.PI === !d.children ? 'start' : 'end'))
    .attr('transform', (d) => (d.x >= Math.PI ? 'rotate(180)' : null))
    .attr('font-size', 9)
    .text((d) => d.data.name);
}

function renderNodeTreemap(nodeId) {
  const node = state.nodeById.get(nodeId);
  dom.treemapCanvas.innerHTML = '';
  if (!node) return;

  const artworks = state.filteredArtworks.filter((art) => node.artworkIds.has(art.id));
  const counts = new Map();

  for (const art of artworks) {
    const attrs = art.attributes;
    const bins = [
      `theme:${attrs.theme}`,
      `rendering:${attrs.rendering}`,
      `material:${attrs.material}`,
      `shape:${attrs.shape}`,
    ];
    for (const key of bins) counts.set(key, (counts.get(key) || 0) + 1);
  }

  const entries = Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  if (!entries.length) {
    dom.treemapCanvas.innerHTML = '<p style="padding:8px;color:#76674f;">No attribute stats for this node.</p>';
    return;
  }

  const width = Math.max(240, dom.treemapCanvas.clientWidth || 240);
  const height = Math.max(140, dom.treemapCanvas.clientHeight || 140);

  const root = d3.hierarchy({ children: entries }).sum((d) => d.value);
  d3.treemap().size([width, height]).padding(2)(root);

  const svg = d3.select(dom.treemapCanvas).append('svg').attr('width', width).attr('height', height);

  const scale = d3.scaleLinear().domain([0, d3.max(entries, (d) => d.value) || 1]).range([0.3, 0.9]);

  svg
    .selectAll('g')
    .data(root.leaves())
    .join('g')
    .attr('transform', (d) => `translate(${d.x0},${d.y0})`)
    .each(function draw(d) {
      const g = d3.select(this);
      g.append('rect')
        .attr('width', Math.max(0, d.x1 - d.x0))
        .attr('height', Math.max(0, d.y1 - d.y0))
        .attr('fill', d.parent?.data?.color || `rgba(158, 117, 67, ${scale(d.value)})`)
        .attr('stroke', '#fff');

      g.append('text')
        .attr('x', 4)
        .attr('y', 14)
        .attr('font-size', 10)
        .attr('fill', '#2e271f')
        .text(`${d.data.name.split(':')[1]} (${d.data.value})`);
    });
}

function renderPaintingList(nodeId) {
  const node = state.nodeById.get(nodeId);
  dom.paintingList.innerHTML = '';

  if (!node) {
    dom.paintingList.innerHTML = '<p style="font-size:0.8rem;color:#76674f;">Select a node from the tree.</p>';
    return;
  }

  const artworks = state.filteredArtworks.filter((art) => node.artworkIds.has(art.id)).slice(0, 20);

  if (!artworks.length) {
    dom.paintingList.innerHTML = '<p style="font-size:0.8rem;color:#76674f;">No paintings found for this color node.</p>';
    return;
  }

  for (const art of artworks) {
    const card = document.createElement('article');
    card.className = 'paint-card';
    const image = art.image?.url
      ? `<img src="${art.image.url}" alt="${art.title}" loading="lazy" />`
      : '<div class="paint-ph">No image</div>';
    card.innerHTML = `
      ${image}
      <div>
        <strong style="font-size:0.76rem;display:block;">${art.title}</strong>
        <div style="font-size:0.7rem;color:#6f5e46;">ID: ${art.id}</div>
        <div style="font-size:0.7rem;color:#6f5e46;">${(art.artistNames || []).join(', ') || 'Unknown artist'}</div>
        <div style="font-size:0.7rem;color:#6f5e46;">${art.attributes.theme}</div>
      </div>
    `;
    dom.paintingList.appendChild(card);
  }
}

function renderColorSearchFromRgb() {
  const rgb = {
    r: clamp(Number(dom.rInput.value) || 0, 0, 255),
    g: clamp(Number(dom.gInput.value) || 0, 0, 255),
    b: clamp(Number(dom.bInput.value) || 0, 0, 255),
  };

  const lab = rgbToLab(rgb);

  let best = null;
  let bestDist = Infinity;
  for (const node of state.colorNodes) {
    const d = deltaE2000(lab, node.lab);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }

  const treeData = createTreeFromRoot(best);
  renderTree(treeData);
  if (best) {
    renderNodeTreemap(best.id);
    renderPaintingList(best.id);
  }
}

function renderColorSearchFromExisting(nodeId) {
  const node = state.nodeById.get(nodeId);
  if (!node) return;
  dom.rInput.value = Math.round(node.rgb.r);
  dom.gInput.value = Math.round(node.rgb.g);
  dom.bInput.value = Math.round(node.rgb.b);
  const treeData = createTreeFromRoot(node);
  renderTree(treeData);
  renderNodeTreemap(node.id);
  renderPaintingList(node.id);
}

function recomputeAndRender() {
  const deltaE = clamp(Number(dom.deltaEInput.value) || 7, 1, 30);
  const weight = clamp(Number(dom.weightSlider.value) || 0.3, 0.05, 1);

  applyScopeFilters();
  buildMergedColorNodes(deltaE);
  buildBipartite();
  buildOneMode(weight);
  computeCentrality();

  if (!state.currentNodeId && state.colorNodes.length) {
    state.currentNodeId = state.colorNodes[0].id;
  }
  if (state.currentNodeId && !state.nodeById.has(state.currentNodeId)) {
    state.currentNodeId = state.colorNodes[0]?.id || null;
  }

  renderBars();
  renderCurrentNode(state.currentNodeId);
  renderNetwork();
  renderHeatmap();
  renderColorSpace();
  renderSankey();
  renderColorSearchFromRgb();

  setStatus(
    `Scope contains ${state.filteredArtworks.length} paintings, ${state.colorNodes.length} merged colors, ${state.oneModeLinks.length} one-mode links.`
  );
}

function attachEvents() {
  dom.searchButton.addEventListener('click', () => {
    state.selectedColorIds = [];
    recomputeAndRender();
  });

  dom.weightSlider.addEventListener('input', () => {
    dom.weightValue.textContent = Number(dom.weightSlider.value).toFixed(2);
    buildOneMode(clamp(Number(dom.weightSlider.value), 0.05, 1));
    computeCentrality();
    renderBars();
    renderCurrentNode(state.currentNodeId);
    renderNetwork();
    renderHeatmap();
    setStatus(`Updated similarity threshold to ${Number(dom.weightSlider.value).toFixed(2)}.`);
  });

  dom.transformButton.addEventListener('click', () => {
    state.mode = state.mode === 'one-mode' ? 'bipartite' : 'one-mode';
    dom.transformButton.textContent = state.mode === 'one-mode' ? 'Transform: One-Mode' : 'Transform: Bipartite';
    renderNetwork();
  });

  dom.spaceButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.spaceMode = button.dataset.space;
      dom.spaceButtons.forEach((b) => b.classList.remove('active'));
      button.classList.add('active');
      renderColorSpace();
    });
  });

  dom.colorSearchButton.addEventListener('click', () => {
    renderColorSearchFromRgb();
  });

  dom.spaceCanvas.addEventListener('click', (event) => {
    const rect = dom.spaceCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let best = null;
    let bestDist = Infinity;
    for (const point of state.scatterPoints) {
      const d = (point.sx - x) ** 2 + (point.sy - y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = point;
      }
    }

    if (!best || bestDist > 180) return;

    const hsv = rgbToHsv(best.rgb);
    const lab = rgbToLab(best.rgb);
    dom.spaceInfo.textContent = `${best.title} | RGB(${best.rgb.r},${best.rgb.g},${best.rgb.b}) | HSV(${hsv.h.toFixed(0)},${hsv.s.toFixed(1)}%,${hsv.v.toFixed(1)}%) | LAB(${lab.l.toFixed(1)},${lab.a.toFixed(1)},${lab.b.toFixed(1)})`;
  });

  window.addEventListener('resize', () => {
    renderNetwork();
    renderSankey();
  });
}

async function init() {
  try {
    setStatus('Loading artworks with palettes...');
    await fetchArtworks();
    populateFilterOptions();
    dom.weightValue.textContent = Number(dom.weightSlider.value).toFixed(2);
    attachEvents();
    recomputeAndRender();
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  }
}

init();
