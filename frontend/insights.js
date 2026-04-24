const API_BASE = 'http://localhost:3001';

const dom = {
  summary: document.getElementById('summaryText'),
  artistChart: document.getElementById('artistChart'),
  timelineChart: document.getElementById('timelineChart'),
  hueChart: document.getElementById('hueChart'),
  collectionChart: document.getElementById('collectionChart'),
};

function clear(el) {
  el.innerHTML = '';
}

function renderTopArtists(data) {
  clear(dom.artistChart);
  const items = (data.topArtists || []).slice(0, 12).reverse();
  const w = dom.artistChart.clientWidth || 520;
  const h = 340;
  const m = { t: 10, r: 16, b: 28, l: 170 };

  const svg = d3.select(dom.artistChart).append('svg').attr('width', w).attr('height', h);
  const x = d3.scaleLinear().domain([0, d3.max(items, (d) => d.count) || 1]).range([m.l, w - m.r]);
  const y = d3
    .scaleBand()
    .domain(items.map((d) => d.artist))
    .range([h - m.b, m.t])
    .padding(0.15);

  svg
    .append('g')
    .selectAll('rect')
    .data(items)
    .join('rect')
    .attr('x', m.l)
    .attr('y', (d) => y(d.artist))
    .attr('width', (d) => x(d.count) - m.l)
    .attr('height', y.bandwidth())
    .attr('fill', '#4c7f87');

  svg
    .append('g')
    .attr('transform', `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).ticks(6));

  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y));
}

function renderTimeline(data) {
  clear(dom.timelineChart);
  const items = data.byDecade || [];
  const w = dom.timelineChart.clientWidth || 520;
  const h = 320;
  const m = { t: 14, r: 14, b: 34, l: 42 };

  const svg = d3.select(dom.timelineChart).append('svg').attr('width', w).attr('height', h);
  const x = d3
    .scaleLinear()
    .domain(d3.extent(items, (d) => d.decade))
    .nice()
    .range([m.l, w - m.r]);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(items, (d) => d.count) || 1])
    .nice()
    .range([h - m.b, m.t]);

  const line = d3
    .line()
    .x((d) => x(d.decade))
    .y((d) => y(d.count));

  svg
    .append('path')
    .datum(items)
    .attr('fill', 'none')
    .attr('stroke', '#b4533a')
    .attr('stroke-width', 2)
    .attr('d', line);

  svg
    .append('g')
    .selectAll('circle')
    .data(items)
    .join('circle')
    .attr('cx', (d) => x(d.decade))
    .attr('cy', (d) => y(d.count))
    .attr('r', 2.6)
    .attr('fill', '#7e3420');

  svg
    .append('g')
    .attr('transform', `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).ticks(10).tickFormat(d3.format('d')));

  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6));
}

function renderHueDistribution(data) {
  clear(dom.hueChart);
  const items = data.hueBins || [];
  const w = dom.hueChart.clientWidth || 520;
  const h = 320;
  const r = Math.min(w, h) * 0.33;

  const colorScale = d3.scaleOrdinal().domain(items.map((d) => d.label)).range(items.map((_, i) => `hsl(${i * 30},70%,52%)`));

  const svg = d3
    .select(dom.hueChart)
    .append('svg')
    .attr('width', w)
    .attr('height', h)
    .append('g')
    .attr('transform', `translate(${w / 2},${h / 2})`);

  const pie = d3.pie().value((d) => d.count).sort(null);
  const arc = d3.arc().innerRadius(r * 0.35).outerRadius(r);

  svg
    .selectAll('path')
    .data(pie(items))
    .join('path')
    .attr('d', arc)
    .attr('fill', (d) => colorScale(d.data.label))
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.1)
    .append('title')
    .text((d) => `${d.data.label}: ${d.data.count}`);
}

function renderCollections(data) {
  clear(dom.collectionChart);
  const items = (data.topCollections || []).slice(0, 10);
  const w = dom.collectionChart.clientWidth || 520;
  const h = 320;
  const m = { t: 14, r: 16, b: 96, l: 42 };

  const svg = d3.select(dom.collectionChart).append('svg').attr('width', w).attr('height', h);
  const x = d3
    .scaleBand()
    .domain(items.map((d) => d.collection))
    .range([m.l, w - m.r])
    .padding(0.2);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(items, (d) => d.count) || 1])
    .nice()
    .range([h - m.b, m.t]);

  svg
    .append('g')
    .selectAll('rect')
    .data(items)
    .join('rect')
    .attr('x', (d) => x(d.collection))
    .attr('y', (d) => y(d.count))
    .attr('width', x.bandwidth())
    .attr('height', (d) => h - m.b - y(d.count))
    .attr('fill', '#7e8c52')
    .append('title')
    .text((d) => `${d.collection}: ${d.count}`);

  svg
    .append('g')
    .attr('transform', `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).tickFormat((v) => v.slice(0, 14)))
    .selectAll('text')
    .attr('transform', 'rotate(-30)')
    .style('text-anchor', 'end');

  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6));
}

async function init() {
  try {
    const response = await fetch(`${API_BASE}/api/insights`);
    if (!response.ok) {
      throw new Error(`Insights fetch failed: ${response.status}`);
    }

    const data = await response.json();
    dom.summary.innerHTML = `
      <div>Total artworks: ${data.totalArtworks}</div>
      <div>Data source: ${data.dataSource}</div>
      <div>Generated: ${new Date(data.generatedAt).toLocaleString()}</div>
      <div>Charts: top artists, decade timeline, dominant hue distribution, and top collections.</div>
    `;

    renderTopArtists(data);
    renderTimeline(data);
    renderHueDistribution(data);
    renderCollections(data);

    window.addEventListener('resize', () => {
      renderTopArtists(data);
      renderTimeline(data);
      renderHueDistribution(data);
      renderCollections(data);
    });
  } catch (error) {
    dom.summary.textContent = `Error: ${error.message}`;
  }
}

init();
