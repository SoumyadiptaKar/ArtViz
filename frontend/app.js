const API_BASE = 'http://localhost:3001';

const fallbackPalette = ['#2f403d', '#e9e6d9', '#b4533a', '#9b9270', '#ddbd67'];

const state = {
  artworks: [],
  filtered: [],
  palette: [],
  filters: {
    artist: '',
    q: '',
    collection: '',
    yearFrom: '',
    yearTo: '',
    limit: 120,
  },
};

const dom = {
  paletteEditor: document.getElementById('paletteEditor'),
  paletteHint: document.getElementById('paletteHint'),
  heroCard: document.getElementById('heroCard'),
  resultsList: document.getElementById('resultsList'),
  statusText: document.getElementById('statusText'),
  template: document.getElementById('resultItemTemplate'),
  artistInput: document.getElementById('artistInput'),
  searchInput: document.getElementById('searchInput'),
  collectionInput: document.getElementById('collectionInput'),
  yearFromInput: document.getElementById('yearFromInput'),
  yearToInput: document.getElementById('yearToInput'),
  limitInput: document.getElementById('limitInput'),
  applyPaletteButton: document.getElementById('applyPaletteButton'),
  addColorButton: document.getElementById('addColorButton'),
  randomPaletteButton: document.getElementById('randomPaletteButton'),
  fromImageButton: document.getElementById('fromImageButton'),
  menuToggle: document.getElementById('menuToggle'),
  controlsDrawer: document.getElementById('controlsDrawer'),
  drawerBackdrop: document.getElementById('drawerBackdrop'),
  applyFiltersButton: document.getElementById('applyFiltersButton'),
  clearFiltersButton: document.getElementById('clearFiltersButton'),
  refreshButton: document.getElementById('refreshButton'),
};

function parsePathPalette() {
  const match = window.location.pathname.match(/\/colors\/([a-fA-F0-9\-]{11,})$/);
  if (!match) {
    return [];
  }

  return match[1]
    .split('-')
    .map((token) => token.trim())
    .filter((token) => /^[a-fA-F0-9]{6}$/.test(token))
    .map((token) => `#${token.toUpperCase()}`);
}

function parseHashPalette() {
  const hash = window.location.hash.replace('#', '').trim();
  if (!hash.startsWith('colors/')) {
    return [];
  }

  return hash
    .replace('colors/', '')
    .split('-')
    .map((token) => token.trim())
    .filter((token) => /^[a-fA-F0-9]{6}$/.test(token))
    .map((token) => `#${token.toUpperCase()}`);
}

function hexToRgb(hex) {
  const raw = String(hex).replace('#', '');
  if (!/^[a-fA-F0-9]{6}$/.test(raw)) {
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

function normalizeHex(input) {
  const value = String(input || '').trim().replace('#', '').toUpperCase();
  if (/^[0-9A-F]{3}$/.test(value)) {
    return `#${value
      .split('')
      .map((c) => `${c}${c}`)
      .join('')}`;
  }

  if (/^[0-9A-F]{6}$/.test(value)) {
    return `#${value}`;
  }

  return null;
}

function getArtworkPalette(artwork) {
  if (!Array.isArray(artwork.palette)) {
    return [];
  }

  return artwork.palette
    .map((entry) => normalizeHex(entry.hex))
    .filter(Boolean)
    .slice(0, 5);
}

function buildPalettePath(colors) {
  const slug = colors.map((hex) => hex.replace('#', '').toLowerCase()).join('-');
  return `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#colors/${slug}`;
}

function scoreArtwork(artwork, queryPalette) {
  const artworkPalette = getArtworkPalette(artwork);
  if (!artworkPalette.length || !queryPalette.length) {
    return -1;
  }

  const queryRgb = queryPalette.map(hexToRgb).filter(Boolean);
  const artRgb = artworkPalette.map(hexToRgb).filter(Boolean);

  if (!queryRgb.length || !artRgb.length) {
    return -1;
  }

  let total = 0;

  for (const q of queryRgb) {
    let best = Infinity;
    for (const a of artRgb) {
      const distance = rgbDistance(q, a);
      if (distance < best) {
        best = distance;
      }
    }

    total += best;
  }

  const averageDistance = total / queryRgb.length;
  const normalized = Math.max(0, 1 - averageDistance / 441.6729);
  return Math.round(normalized * 1000) / 10;
}

function readFiltersFromInputs() {
  state.filters.artist = dom.artistInput.value.trim();
  state.filters.q = dom.searchInput.value.trim();
  state.filters.collection = dom.collectionInput.value.trim();
  state.filters.yearFrom = dom.yearFromInput.value.trim();
  state.filters.yearTo = dom.yearToInput.value.trim();
  state.filters.limit = Number(dom.limitInput.value) || 120;
}

function applyPaletteRanking() {
  const ranked = state.artworks
    .map((artwork) => ({
      ...artwork,
      score: scoreArtwork(artwork, state.palette),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)));

  state.filtered = ranked;
  renderResults();
}

function createSwatches(container, colors) {
  container.innerHTML = '';
  const palette = colors.length ? colors : ['#C8C1B3'];

  for (const color of palette) {
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = color;
    swatch.title = color;
    container.appendChild(swatch);
  }
}

function renderHero() {
  const hero = state.filtered[0];

  if (!hero) {
    dom.heroCard.innerHTML = '<p>No artwork match yet. Try changing your palette.</p>';
    return;
  }

  const palette = getArtworkPalette(hero);
  const artist = hero.artistNames?.join(', ') || 'Unknown artist';
  const timeline = hero.timeline?.label || hero.timeline?.yearFrom || hero.timeline?.yearTo || 'Year unknown';
  const description = hero.description || 'No description available.';

  dom.heroCard.innerHTML = `
    <img class="hero-image" src="${hero.image?.url || ''}" alt="${hero.title || 'Artwork'}" />
    <div class="hero-meta">
      <h2>${hero.title || 'Untitled'}</h2>
      <p>${artist}</p>
      <p>${timeline}</p>
      <p>Palette similarity: ${hero.score}%</p>
    </div>
    <div class="swatch-row" id="heroSwatches"></div>
    <p>${description}</p>
  `;

  const heroSwatches = document.getElementById('heroSwatches');
  createSwatches(heroSwatches, palette);
}

function renderResults() {
  dom.resultsList.innerHTML = '';
  const subset = state.filtered.slice(0, 80);
  dom.statusText.textContent = `${subset.length} matches from ${state.filtered.length} ranked artworks`;

  renderHero();

  for (const artwork of subset) {
    const node = dom.template.content.cloneNode(true);
    const item = node.querySelector('.result-item');
    const img = node.querySelector('.thumb');
    const title = node.querySelector('h3');
    const artist = node.querySelector('.artist');
    const meta = node.querySelector('.meta');
    const miniPalette = node.querySelector('.mini-palette');

    img.src = artwork.image?.url || '';
    img.alt = artwork.title || 'Artwork';
    title.textContent = artwork.title || 'Untitled';
    artist.textContent = artwork.artistNames?.join(', ') || 'Unknown artist';

    const timeline = artwork.timeline?.label || artwork.timeline?.yearFrom || artwork.timeline?.yearTo || 'Year unknown';
    meta.textContent = `${timeline} • Score ${artwork.score}%`;

    createSwatches(miniPalette, getArtworkPalette(artwork));

    item.addEventListener('click', () => {
      const nextPalette = getArtworkPalette(artwork);
      if (nextPalette.length) {
        state.palette = nextPalette;
        renderPaletteEditor();
        applyPaletteRanking();
      }
    });

    dom.resultsList.appendChild(node);
  }
}

function renderPaletteEditor() {
  dom.paletteEditor.innerHTML = '';
  dom.paletteHint.textContent = buildPalettePath(state.palette);

  for (let i = 0; i < state.palette.length; i += 1) {
    const color = state.palette[i];
    const chip = document.createElement('li');
    chip.className = 'palette-item';

    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = color;

    const text = document.createElement('input');
    text.type = 'text';
    text.value = color;

    const remove = document.createElement('button');
    remove.className = 'chip-btn';
    remove.type = 'button';
    remove.textContent = 'X';
    remove.title = 'Remove color';

    picker.addEventListener('input', (event) => {
      const next = normalizeHex(event.target.value);
      if (next) {
        state.palette[i] = next;
        text.value = next;
      }
    });

    text.addEventListener('change', (event) => {
      const next = normalizeHex(event.target.value);
      if (next) {
        state.palette[i] = next;
        picker.value = next;
        text.value = next;
      } else {
        text.value = state.palette[i];
      }
    });

    remove.addEventListener('click', () => {
      if (state.palette.length <= 2) {
        return;
      }
      state.palette.splice(i, 1);
      renderPaletteEditor();
    });

    chip.appendChild(picker);
    chip.appendChild(text);
    chip.appendChild(remove);
    dom.paletteEditor.appendChild(chip);
  }
}

function randomColor() {
  const value = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `#${value.toUpperCase()}`;
}

async function fetchArtworks() {
  readFiltersFromInputs();

  const params = new URLSearchParams();
  params.set('includePalette', 'true');
  params.set('limit', String(Math.max(20, Math.min(250, state.filters.limit))));

  if (state.filters.artist) params.set('artist', state.filters.artist);
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.collection) params.set('collection', state.filters.collection);
  if (state.filters.yearFrom) params.set('yearFrom', state.filters.yearFrom);
  if (state.filters.yearTo) params.set('yearTo', state.filters.yearTo);

  dom.statusText.textContent = 'Loading artworks and palette cache...';

  const response = await fetch(`${API_BASE}/api/artworks?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const payload = await response.json();
  state.artworks = Array.isArray(payload.items) ? payload.items : [];
}

async function refreshCatalog() {
  dom.statusText.textContent = 'Refreshing backend catalog...';
  const response = await fetch(`${API_BASE}/api/refresh`, { method: 'POST' });
  if (!response.ok) {
    throw new Error('Catalog refresh failed');
  }
}

function resetFilters() {
  dom.artistInput.value = '';
  dom.searchInput.value = '';
  dom.collectionInput.value = '';
  dom.yearFromInput.value = '';
  dom.yearToInput.value = '';
  dom.limitInput.value = '120';
}

function openDrawer() {
  document.body.classList.add('drawer-open');
}

function closeDrawer() {
  document.body.classList.remove('drawer-open');
}

function attachEvents() {
  dom.applyPaletteButton.addEventListener('click', () => {
    applyPaletteRanking();
  });

  dom.addColorButton.addEventListener('click', () => {
    state.palette.push(randomColor());
    renderPaletteEditor();
  });

  dom.randomPaletteButton.addEventListener('click', () => {
    state.palette = Array.from({ length: 5 }, () => randomColor());
    renderPaletteEditor();
    applyPaletteRanking();
  });

  if (dom.fromImageButton) {
    dom.fromImageButton.addEventListener('click', () => {
      dom.statusText.textContent = 'Image-based palette extraction UI is not enabled yet in this version.';
    });
  }

  dom.applyFiltersButton.addEventListener('click', async () => {
    try {
      await fetchArtworks();
      applyPaletteRanking();
      closeDrawer();
    } catch (error) {
      dom.statusText.textContent = `Error: ${error.message}`;
    }
  });

  dom.clearFiltersButton.addEventListener('click', async () => {
    resetFilters();
    try {
      await fetchArtworks();
      applyPaletteRanking();
      closeDrawer();
    } catch (error) {
      dom.statusText.textContent = `Error: ${error.message}`;
    }
  });

  dom.refreshButton.addEventListener('click', async () => {
    try {
      await refreshCatalog();
      await fetchArtworks();
      applyPaletteRanking();
      closeDrawer();
    } catch (error) {
      dom.statusText.textContent = `Error: ${error.message}`;
    }
  });

  if (dom.menuToggle) {
    dom.menuToggle.addEventListener('click', () => {
      const isOpen = document.body.classList.contains('drawer-open');
      if (isOpen) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }

  if (dom.drawerBackdrop) {
    dom.drawerBackdrop.addEventListener('click', closeDrawer);
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDrawer();
    }
  });
}

async function init() {
  const parsedFromPath = parsePathPalette();
  const parsedFromHash = parseHashPalette();
  const initial = parsedFromPath.length ? parsedFromPath : parsedFromHash.length ? parsedFromHash : fallbackPalette;

  state.palette = initial.slice(0, 7);

  renderPaletteEditor();
  attachEvents();

  try {
    await fetchArtworks();
    applyPaletteRanking();
  } catch (error) {
    dom.statusText.textContent = `Error: ${error.message}`;
  }
}

init();
