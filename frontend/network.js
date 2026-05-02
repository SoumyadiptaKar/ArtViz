const API_BASE = window.__API_BASE__ || (window.location.port === '8000' ? 'http://localhost:3001' : '/api');

const dom = {
  container: document.getElementById('graphContainer'),
  statusText: document.getElementById('statusText'),
  details: document.getElementById('detailsContent'),
  stats: document.getElementById('stats'),
  colorMatches: document.getElementById('colorMatches'),
  minArtworks: document.getElementById('minArtworks'),
  similarity: document.getElementById('similarity'),
  maxArtists: document.getElementById('maxArtists'),
  colorPicker: document.getElementById('colorPicker'),
  colorThreshold: document.getElementById('colorThreshold'),
  minArtworksValue: document.getElementById('minArtworksValue'),
  similarityValue: document.getElementById('similarityValue'),
  maxArtistsValue: document.getElementById('maxArtistsValue'),
  colorPickerValue: document.getElementById('colorPickerValue'),
  colorThresholdValue: document.getElementById('colorThresholdValue'),
  reloadButton: document.getElementById('reloadButton'),
};

let fullNetwork = null;
const MAX_RGB_DISTANCE = Math.sqrt(255 * 255 * 3);

function updateControlLabels() {
  dom.minArtworksValue.textContent = dom.minArtworks.value;
  dom.similarityValue.textContent = Number(dom.similarity.value).toFixed(2);
  dom.maxArtistsValue.textContent = dom.maxArtists.value;
  dom.colorPickerValue.textContent = String(dom.colorPicker.value || '').toUpperCase();
  dom.colorThresholdValue.textContent = Number(dom.colorThreshold.value).toFixed(2);
}

function hexToRgb(hex) {
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(raw)) {
    return null;
  }

  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function rgbDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function getLinkNodeId(ref) {
  if (!ref) {
    return null;
  }

  if (typeof ref === 'string') {
    return ref;
  }

  if (typeof ref === 'object' && typeof ref.id === 'string') {
    return ref.id;
  }

  return null;
}

function computeColorMatchState(nodes) {
  const threshold = Number(dom.colorThreshold.value);
  const target = hexToRgb(dom.colorPicker.value);

  if (!target) {
    return {
      threshold,
      scores: new Map(),
      matched: [],
    };
  }

  const scored = nodes.map((node) => {
    const similarity = 1 - rgbDistance(node.avgRgb, target) / MAX_RGB_DISTANCE;
    return {
      id: node.id,
      label: node.label,
      similarity,
      artworkCount: node.artworkCount,
    };
  });

  const scores = new Map(scored.map((entry) => [entry.id, entry.similarity]));
  const matched = scored
    .filter((entry) => entry.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 8);

  return {
    threshold,
    scores,
    matched,
  };
}

function nodeRadius(node) {
  return Math.max(4, Math.min(18, 4 + Math.sqrt(node.artworkCount || 1)));
}

function linkStrokeWidth(link) {
  return Math.max(0.4, (link.similarity - 0.6) * 6);
}

function renderDetails(node) {
  if (!node) {
    dom.details.textContent = 'Hover or click an artist node.';
    return;
  }

  const samplePaintings = Array.isArray(node.artworks) ? node.artworks.slice(0, 6) : [];
  const sampleMarkup = samplePaintings.length
    ? `
      <div class="painting-samples">
        ${samplePaintings
          .map((artwork) => {
            const imageMarkup = artwork.imageUrl
              ? `<img src="${artwork.imageUrl}" alt="${artwork.title}" loading="lazy" />`
              : `<div class="painting-placeholder">No image</div>`;

            return `
              <article class="painting-sample">
                <div class="painting-thumb">${imageMarkup}</div>
                <div class="painting-meta">
                  <strong>${artwork.title}</strong>
                  <span>${artwork.yearLabel || artwork.collection || 'Painting'}</span>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `
    : '<p>No sample paintings available.</p>';

  dom.details.innerHTML = `
    <p><strong>${node.label}</strong></p>
    <p>Artworks: ${node.artworkCount}</p>
    <p><span class="artist-chip" style="background:${node.avgHex}"></span>Average palette color: ${node.avgHex}</p>
    ${sampleMarkup}
  `;
}

function renderColorMatches(matchState) {
  if (!matchState.matched.length) {
    dom.colorMatches.innerHTML = '<h3>Top Color Matches</h3><p>No artists above threshold.</p>';
    return;
  }

  const items = matchState.matched
    .map(
      (entry) =>
        `<li><strong>${entry.label}</strong> - ${Math.round(entry.similarity * 100)}% match (${entry.artworkCount} artworks)</li>`
    )
    .join('');

  dom.colorMatches.innerHTML = `<h3>Top Color Matches</h3><ol>${items}</ol>`;
}

function renderGraph(payload) {
  const nodes = payload.nodes.map((node) => ({ ...node }));
  const links = payload.links.map((link) => ({ ...link }));
  const matchState = computeColorMatchState(nodes);
  renderColorMatches(matchState);

  dom.container.innerHTML = '';

  if (!nodes.length) {
    dom.container.innerHTML = '<p style="padding:16px;color:#645d56;">No network data for this filter set.</p>';
    return;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const safeLinks = links.filter((link) => {
    const sourceId = getLinkNodeId(link.source);
    const targetId = getLinkNodeId(link.target);
    return Boolean(sourceId && targetId && nodeIds.has(sourceId) && nodeIds.has(targetId));
  });

  if (!safeLinks.length) {
    dom.container.innerHTML = '<p style="padding:16px;color:#645d56;">No valid relationships for this filter set.</p>';
    return;
  }

  const width = Math.max(dom.container.clientWidth, 900);
  const height = Math.max(dom.container.clientHeight, 560);

  const svg = d3
    .select(dom.container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const viewport = svg.append('g');

  svg.call(
    d3.zoom().scaleExtent([0.25, 4]).on('zoom', (event) => {
      viewport.attr('transform', event.transform);
    })
  );

  const linkLayer = viewport.append('g').attr('stroke', '#8d8474');
  const link = linkLayer
    .selectAll('line')
    .data(safeLinks)
    .join('line')
    .attr('stroke-opacity', (d) => {
      const sourceId = getLinkNodeId(d.source);
      const targetId = getLinkNodeId(d.target);
      const sourceScore = matchState.scores.get(sourceId) ?? 0;
      const targetScore = matchState.scores.get(targetId) ?? 0;
      const active = sourceScore >= matchState.threshold || targetScore >= matchState.threshold;
      return active ? 0.45 : 0.12;
    })
    .attr('stroke-width', (d) => linkStrokeWidth(d));

  const node = viewport
    .append('g')
    .attr('stroke', '#fff')
    .attr('stroke-width', 0.8)
    .selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('r', (d) => nodeRadius(d))
    .attr('fill', (d) => d.avgHex)
    .attr('stroke', (d) => {
      const score = matchState.scores.get(d.id) ?? 0;
      return score >= matchState.threshold ? '#0f0f0f' : '#ffffff';
    })
    .attr('stroke-width', (d) => {
      const score = matchState.scores.get(d.id) ?? 0;
      return score >= matchState.threshold ? 2.2 : 0.8;
    })
    .attr('opacity', (d) => {
      const score = matchState.scores.get(d.id) ?? 0;
      return score >= matchState.threshold ? 1 : 0.28;
    })
    .style('cursor', 'pointer')
    .on('mouseenter', (_, d) => renderDetails(d))
    .on('click', (_, d) => renderDetails(d));

  node.append('title').text((d) => `${d.label}\nArtworks: ${d.artworkCount}\nAvg: ${d.avgHex}`);

  const simulation = d3
    .forceSimulation(nodes)
    .force('charge', d3.forceManyBody().strength(-24))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius((d) => nodeRadius(d) + 2));

  if (safeLinks.length) {
    simulation.force('link', d3.forceLink(safeLinks).id((d) => d.id).distance((d) => 120 - (d.similarity - 0.6) * 90));
  }

  node.call(
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
    if (safeLinks.length) {
      link
        .attr('x1', (d) => d.source?.x ?? 0)
        .attr('y1', (d) => d.source?.y ?? 0)
        .attr('x2', (d) => d.target?.x ?? 0)
        .attr('y2', (d) => d.target?.y ?? 0);
    }

    node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
  });
}

function filterNetwork(raw) {
  const threshold = Number(dom.similarity.value);
  const maxArtists = Number(dom.maxArtists.value);

  const allowedNodes = new Set(raw.nodes.slice(0, maxArtists).map((node) => node.id));
  const nodes = raw.nodes.filter((node) => allowedNodes.has(node.id));
  const links = raw.links.filter((link) => {
    const sourceId = getLinkNodeId(link.source);
    const targetId = getLinkNodeId(link.target);
    return Boolean(
      sourceId &&
        targetId &&
        allowedNodes.has(sourceId) &&
        allowedNodes.has(targetId) &&
        link.similarity >= threshold
    );
  });

  const connected = new Set();
  for (const link of links) {
    const sourceId = getLinkNodeId(link.source);
    const targetId = getLinkNodeId(link.target);
    if (sourceId) connected.add(sourceId);
    if (targetId) connected.add(targetId);
  }

  return {
    nodes: connected.size ? nodes.filter((node) => connected.has(node.id)) : nodes,
    links,
  };
}

function renderStats(filtered) {
  const colorMatches = computeColorMatchState(filtered.nodes).matched.length;
  dom.stats.innerHTML = `
    <div>Artists in source: ${fullNetwork.totalArtistsWithPalettes}</div>
    <div>Artists shown: ${filtered.nodes.length}</div>
    <div>Relationships shown: ${filtered.links.length}</div>
    <div>Color-matched artists: ${colorMatches}</div>
    <div>Generated: ${new Date(fullNetwork.generatedAt).toLocaleString()}</div>
  `;
}

async function loadNetwork() {
  const minArtworks = Number(dom.minArtworks.value);
  dom.statusText.textContent = 'Loading network...';

  const params = new URLSearchParams({
    minArtworks: String(minArtworks),
    maxArtists: '900',
    maxEdges: '5000',
  });

  const response = await fetch(`${API_BASE}/api/network?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Network fetch failed: ${response.status}`);
  }

  fullNetwork = await response.json();

  const filtered = filterNetwork(fullNetwork);
  renderGraph(filtered);
  renderStats(filtered);

  dom.statusText.textContent = 'Drag nodes, zoom canvas, and hover for details.';
}

function rerenderFromCurrentControls() {
  if (!fullNetwork) {
    return;
  }

  const filtered = filterNetwork(fullNetwork);
  renderGraph(filtered);
  renderStats(filtered);
}

function attachEvents() {
  updateControlLabels();

  dom.minArtworks.addEventListener('input', () => {
    updateControlLabels();
  });
  dom.similarity.addEventListener('input', () => {
    updateControlLabels();
    rerenderFromCurrentControls();
  });
  dom.maxArtists.addEventListener('input', () => {
    updateControlLabels();
    rerenderFromCurrentControls();
  });
  dom.colorPicker.addEventListener('input', () => {
    updateControlLabels();
    rerenderFromCurrentControls();
  });
  dom.colorThreshold.addEventListener('input', () => {
    updateControlLabels();
    rerenderFromCurrentControls();
  });

  dom.reloadButton.addEventListener('click', async () => {
    try {
      await loadNetwork();
    } catch (error) {
      dom.statusText.textContent = `Error: ${error.message}`;
    }
  });

  window.addEventListener('resize', () => {
    rerenderFromCurrentControls();
  });
}

async function init() {
  attachEvents();

  try {
    await loadNetwork();
  } catch (error) {
    dom.statusText.textContent = `Error: ${error.message}`;
  }
}

init();
