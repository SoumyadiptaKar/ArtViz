const API_BASE = 'http://localhost:3001';

const dom = {
  artistLimit: document.getElementById('artistLimit'),
  artistLimitValue: document.getElementById('artistLimitValue'),
  edgeThreshold: document.getElementById('edgeThreshold'),
  edgeThresholdValue: document.getElementById('edgeThresholdValue'),
  targetColor: document.getElementById('targetColor'),
  targetColorValue: document.getElementById('targetColorValue'),
  colorMatches: document.getElementById('colorMatches'),
  reloadButton: document.getElementById('reloadButton'),
  summary: document.getElementById('summary'),
  networkChart: document.getElementById('networkChart'),
  flowChart: document.getElementById('flowChart'),
  matrixChart: document.getElementById('matrixChart'),
};

let payload = null;

function updateControlLabels() {
  dom.artistLimitValue.textContent = dom.artistLimit.value;
  dom.edgeThresholdValue.textContent = dom.edgeThreshold.value;
  dom.targetColorValue.textContent = String(dom.targetColor.value || '').toUpperCase();
}

function clear(el) {
  if (el) {
    el.innerHTML = '';
  }
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

function hueLabelFromHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return null;
  }

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  }

  const bin = Math.min(11, Math.floor(hue / 30));
  return `${bin * 30}-${bin * 30 + 29}`;
}

function renderSummary(data) {
  dom.summary.innerHTML = `
    <div>Total artworks: ${data.totalArtworks}</div>
    <div>Data source: ${data.dataSource}</div>
    <div>Color nodes: ${data.colorNodes.length}</div>
    <div>Color links: ${data.colorLinks.length}</div>
    <div>Generated: ${new Date(data.generatedAt).toLocaleString()}</div>
  `;
}

function renderColorNetwork(data) {
  clear(dom.networkChart);

  const edgeMin = Number(dom.edgeThreshold.value);
  const nodes = data.colorNodes.map((d) => ({ ...d }));
  const links = data.colorLinks.filter((d) => d.weight >= edgeMin).map((d) => ({ ...d }));

  if (!nodes.length || !links.length) {
    dom.networkChart.innerHTML = '<p style="padding:16px;color:#645d56;">No color links for this threshold.</p>';
    return;
  }

  const w = Math.max(dom.networkChart.clientWidth, 800);
  const h = 480;
  const svg = d3.select(dom.networkChart).append('svg').attr('width', w).attr('height', h);

  const viewport = svg.append('g');
  svg.call(
    d3.zoom().scaleExtent([0.4, 3]).on('zoom', (event) => {
      viewport.attr('transform', event.transform);
    })
  );

  const link = viewport
    .append('g')
    .attr('stroke', '#8d8474')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke-opacity', 0.28)
    .attr('stroke-width', (d) => Math.max(0.8, Math.log2(d.weight + 1)));

  const node = viewport
    .append('g')
    .selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('r', (d) => Math.max(8, Math.sqrt(d.count) * 0.42))
    .attr('fill', (d) => d.color)
    .attr('stroke', '#12110f')
    .attr('stroke-width', 1)
    .style('cursor', 'pointer');

  node.append('title').text((d) => `Hue ${d.label}\nPaintings: ${d.count}`);

  const label = viewport
    .append('g')
    .selectAll('text')
    .data(nodes)
    .join('text')
    .text((d) => d.label)
    .attr('font-size', 10)
    .attr('fill', '#3d352f')
    .attr('text-anchor', 'middle')
    .attr('dy', 3);

  const simulation = d3
    .forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.id).distance((d) => 130 - Math.log2(d.weight + 1) * 18))
    .force('charge', d3.forceManyBody().strength(-120))
    .force('center', d3.forceCenter(w / 2, h / 2))
    .force('collide', d3.forceCollide().radius((d) => Math.max(10, Math.sqrt(d.count) * 0.42) + 2));

  node.call(
    d3
      .drag()
      .on('start', (event, d) => {
        if (!event.active) {
          simulation.alphaTarget(0.2).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
      })
  );

  simulation.on('tick', () => {
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);
    label.attr('x', (d) => d.x).attr('y', (d) => d.y);
  });
}

function renderFlow(data) {
  clear(dom.flowChart);

  if (typeof d3.sankey !== 'function') {
    dom.flowChart.innerHTML = '<p style="padding:16px;color:#645d56;">Sankey library unavailable.</p>';
    return;
  }

  const rows = data.artistColorMatrix.slice(0, Number(dom.artistLimit.value));
  if (!rows.length) {
    dom.flowChart.innerHTML = '<p style="padding:16px;color:#645d56;">No flow data.</p>';
    return;
  }

  const hueLabels = rows[0].colors.map((c) => c.hueLabel);
  const nodes = [
    ...hueLabels.map((h) => ({ id: `h-${h}`, name: h, side: 'hue' })),
    ...rows.map((r) => ({ id: `a-${r.artist}`, name: r.artist, side: 'artist' })),
  ];

  const links = [];
  for (const row of rows) {
    for (const cell of row.colors) {
      if (cell.count > 0) {
        links.push({
          source: `h-${cell.hueLabel}`,
          target: `a-${row.artist}`,
          value: cell.count,
        });
      }
    }
  }

  const w = Math.max(dom.flowChart.clientWidth, 1000);
  const h = Math.max(400, rows.length * 24 + 160);

  const sankey = d3
    .sankey()
    .nodeId((d) => d.id)
    .nodeWidth(16)
    .nodePadding(12)
    .extent([
      [140, 20],
      [w - 140, h - 40],
    ]);

  const graph = sankey({
    nodes: nodes.map((d) => ({ ...d })),
    links: links.map((d) => ({ ...d })),
  });

  const svg = d3.select(dom.flowChart).append('svg').attr('width', w).attr('height', h);

  // Add legend
  const legend = svg.append('g').attr('transform', `translate(12, 8)`);
  legend
    .append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', 12)
    .attr('height', 12)
    .attr('fill', '#b4533a');
  legend.append('text').attr('x', 18).attr('y', 10).attr('font-size', 11).attr('fill', '#645d56').text('Hue Bins');

  legend
    .append('rect')
    .attr('x', 110)
    .attr('y', 0)
    .attr('width', 12)
    .attr('height', 12)
    .attr('fill', '#4c7f87');
  legend.append('text').attr('x', 128).attr('y', 10).attr('font-size', 11).attr('fill', '#645d56').text('Artists');

  // Draw links with flow labels
  const linkGroup = svg.append('g').attr('fill', 'none');
  const linkPaths = linkGroup
    .selectAll('path')
    .data(graph.links)
    .join('path')
    .attr('d', d3.sankeyLinkHorizontal())
    .attr('stroke', '#8d8474')
    .attr('stroke-opacity', 0.25)
    .attr('stroke-width', (d) => Math.max(1.4, d.width));

  linkPaths.append('title').text((d) => `${d.source.name} → ${d.target.name}\n${d.value} artwork${d.value > 1 ? 's' : ''}`);

  // Draw nodes
  const nodeGroup = svg.append('g');
  const node = nodeGroup
    .selectAll('rect')
    .data(graph.nodes)
    .join('rect')
    .attr('x', (d) => d.x0)
    .attr('y', (d) => d.y0)
    .attr('height', (d) => Math.max(1, d.y1 - d.y0))
    .attr('width', (d) => d.x1 - d.x0)
    .attr('fill', (d) => (d.side === 'hue' ? '#b4533a' : '#4c7f87'))
    .attr('stroke', '#fff')
    .attr('stroke-width', 0.8);

  node.append('title').text((d) => `${d.name}\n(click to explore)`);

  // Add node labels with better styling
  const textGroup = svg.append('g');
  textGroup
    .selectAll('text')
    .data(graph.nodes)
    .join('text')
    .attr('x', (d) => (d.side === 'hue' ? d.x0 - 12 : d.x1 + 12))
    .attr('y', (d) => (d.y0 + d.y1) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', (d) => (d.side === 'hue' ? 'end' : 'start'))
    .attr('font-size', 12)
    .attr('font-weight', 500)
    .attr('fill', '#3d352f')
    .text((d) => {
      const name = d.name.slice(0, 20);
      return d.side === 'hue' ? `${name}°` : name;
    });

  // Add node value labels inside or near boxes
  textGroup
    .selectAll('.node-value')
    .data(graph.nodes)
    .join('text')
    .attr('class', 'node-value')
    .attr('x', (d) => (d.x0 + d.x1) / 2)
    .attr('y', (d) => (d.y0 + d.y1) / 2)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('font-size', 10)
    .attr('fill', '#fff')
    .attr('font-weight', 'bold')
    .attr('pointer-events', 'none')
    .text((d) => {
      const hasValue = d.value !== undefined;
      return hasValue ? d.value : '';
    });
}

function renderMatrix(data) {
  clear(dom.matrixChart);

  const topN = Number(dom.artistLimit.value);
  const rows = data.artistColorMatrix.slice(0, topN);
  if (!rows.length) {
    dom.matrixChart.innerHTML = '<p style="padding:16px;color:#645d56;">No matrix data.</p>';
    return;
  }

  const hues = rows[0].colors.map((c) => c.hueLabel);
  const matrix = [];
  for (const row of rows) {
    for (const cell of row.colors) {
      matrix.push({
        artist: row.artist,
        hue: cell.hueLabel,
        ratio: cell.ratio,
        count: cell.count,
      });
    }
  }

  const w = Math.max(dom.matrixChart.clientWidth, 1000);
  const h = Math.max(340, rows.length * 22 + 120);
  const m = { t: 20, r: 16, b: 70, l: 220 };

  const svg = d3.select(dom.matrixChart).append('svg').attr('width', w).attr('height', h);

  const x = d3.scaleBand().domain(hues).range([m.l, w - m.r]).padding(0.06);
  const y = d3
    .scaleBand()
    .domain(rows.map((d) => d.artist))
    .range([m.t, h - m.b])
    .padding(0.06);
  const color = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, d3.max(matrix, (d) => d.ratio) || 0.001]);

  svg
    .append('g')
    .selectAll('rect')
    .data(matrix)
    .join('rect')
    .attr('x', (d) => x(d.hue))
    .attr('y', (d) => y(d.artist))
    .attr('width', x.bandwidth())
    .attr('height', y.bandwidth())
    .attr('fill', (d) => color(d.ratio))
    .append('title')
    .text((d) => `${d.artist}\nHue ${d.hue}\nCount ${d.count}\nRatio ${(d.ratio * 100).toFixed(1)}%`);

  svg
    .append('g')
    .attr('transform', `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x))
    .selectAll('text')
    console.warn('Cannot rerender: payload is null');
    return;
  }

  console.log('Rerendering with current controls...');
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickSize(0));
}

function renderColorSearch(data) {
  const selected = String(dom.targetColor.value || '#8F806B').toUpperCase();
  const selectedRgb = hexToRgb(selected);
  if (!selectedRgb) {
    dom.colorMatches.innerHTML = '<div>Invalid selected color.</div>';
    return;
  }

  const hueMatches = data.colorNodes
    .map((node) => ({
      ...node,
      distance: rgbDistance(selectedRgb, hexToRgb(node.color) || selectedRgb),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 4);

  const handleArtistLimitChange = () => {
    console.log('Artist limit changed to:', dom.artistLimit.value);
    updateControlLabels();
    rerender();
  };

  const handleEdgeThresholdChange = () => {
    console.log('Edge threshold changed to:', dom.edgeThreshold.value);
    updateControlLabels();
    rerender();
  };

  const handleColorChange = () => {
    console.log('Color changed to:', dom.targetColor.value);
    updateControlLabels();
    rerender();
  };

  dom.artistLimit.addEventListener('input', handleArtistLimitChange);
  dom.edgeThreshold.addEventListener('input', handleEdgeThresholdChange);
  dom.targetColor.addEventListener('input', handleColorChange);

  // Also handle change events (some browsers fire these instead of input)
  dom.artistLimit.addEventListener('change', handleArtistLimitChange);
  dom.edgeThreshold.addEventListener('change', handleEdgeThresholdChange);
  dom.targetColor.addEventListener('change', handleColorChange <div><strong>Selected:</strong> ${selected}</div>
    <div><strong>Nearest hue bins:</strong> ${hueMatches.map((h) => h.label).join(', ')}</div>
    <div><strong>Top artists for hue ${targetHue}:</strong></div>
    <ol style="margin:6px 0 0 18px; padding:0;">
      ${artistMatches.map((m) => `<li>${m.artist} (${Math.round(m.score * 100)}%)</li>`).join('')}
    </ol>
  `;
}

function rerender() {
  if (!payload) {
    return;
  }

  renderSummary(payload);
  renderColorNetwork(payload);
  renderFlow(payload);
  renderMatrix(payload);
  renderColorSearch(payload);
}

async function loadData() {
  const artistLimit = Number(dom.artistLimit.value);
  const response = await fetch(`${API_BASE}/api/colornet?maxArtists=${artistLimit}`);
  if (!response.ok) {
    throw new Error(`ColorNet fetch failed: ${response.status}`);
  }

  payload = await response.json();
  rerender();
}

function attachEvents() {
  updateControlLabels();

  dom.artistLimit.addEventListener('input', () => {
    updateControlLabels();
    rerender();
  });

  dom.edgeThreshold.addEventListener('input', () => {
    updateControlLabels();
    rerender();
  });

  dom.targetColor.addEventListener('input', () => {
    updateControlLabels();
    rerender();
  });

  dom.reloadButton.addEventListener('click', async () => {
    try {
      await loadData();
    } catch (error) {
      dom.summary.textContent = `Error: ${error.message}`;
    }
  });

  window.addEventListener('resize', () => {
    rerender();
  });
}

async function init() {
  attachEvents();
  try {
    await loadData();
  } catch (error) {
    dom.summary.textContent = `Error: ${error.message}`;
  }
}

init();
