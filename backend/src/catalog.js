const fs = require('fs/promises');
const path = require('path');
const { cachePath, objectsEndpoint, mediaBaseUrl, extractColors, colorWorkers, artworksWithPalettesPath } = require('./env');
const { normalizeArtwork, filterPaintings, applyArtworksQuery, computeFacets } = require('./filter');
const { extractPaletteFromImageUrl } = require('./palette');

function hexToRgb(hex) {
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    return null;
  }

  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function paletteToRgbColors(palette) {
  if (!Array.isArray(palette)) {
    return [];
  }

  return palette
    .map((entry) => {
      if (typeof entry === 'string') {
        return hexToRgb(entry);
      }

      if (entry && typeof entry === 'object' && Array.isArray(entry.rgb) && entry.rgb.length === 3) {
        const [r, g, b] = entry.rgb;
        return { r, g, b };
      }

      if (entry && typeof entry === 'object' && typeof entry.hex === 'string') {
        return hexToRgb(entry.hex);
      }

      return null;
    })
    .filter(Boolean);
}

function rgbDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function averageRgb(colors) {
  if (!colors.length) {
    return null;
  }

  const totals = colors.reduce(
    (acc, color) => {
      acc.r += color.r;
      acc.g += color.g;
      acc.b += color.b;
      return acc;
    },
    { r: 0, g: 0, b: 0 }
  );

  return {
    r: Math.round(totals.r / colors.length),
    g: Math.round(totals.g / colors.length),
    b: Math.round(totals.b / colors.length),
  };
}

const state = {
  catalog: null,
  refreshPromise: null,
  warmupPromise: null,
  lastError: null,
  artworksWithPalettesCache: null,
};

async function ensureCacheDirectory() {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
}

async function readCacheFile() {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.artworks)) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

async function writeCacheFile(catalog) {
  await ensureCacheDirectory();
  await fs.writeFile(cachePath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}

async function fetchAllObjects() {
  const response = await fetch(objectsEndpoint, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to fetch FNG objects: ${response.status} ${response.statusText} ${message}`.trim());
  }

  return response.json();
}

async function pool(items, workerCount, iterator) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      results[currentIndex] = await iterator(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(workerCount, items.length || 1) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function enrichPalette(artwork) {
  if (!extractColors || !artwork.image?.url) {
    return artwork;
  }

  if (artwork.paletteStatus === 'ready' && Array.isArray(artwork.palette) && artwork.palette.length) {
    return artwork;
  }

  try {
    const palette = await extractPaletteFromImageUrl(artwork.image.url, { colorCount: 5 });
    return {
      ...artwork,
      palette,
      paletteStatus: 'ready',
    };
  } catch (error) {
    return {
      ...artwork,
      palette: [],
      paletteStatus: 'error',
      paletteError: error.message,
    };
  }
}

async function buildCatalog() {
  const rawObjects = await fetchAllObjects();
  const normalized = rawObjects.map((object) => normalizeArtwork(object, mediaBaseUrl));
  const paintings = filterPaintings(normalized);
  const catalog = {
    source: {
      objectsEndpoint,
      mediaBaseUrl,
      totalObjects: rawObjects.length,
      totalPaintings: paintings.length,
      extractColors,
      colorWorkers,
    },
    updatedAt: new Date().toISOString(),
    artworks: paintings,
    facets: computeFacets(paintings),
  };

  await writeCacheFile(catalog);
  return catalog;
}

async function refreshCatalog() {
  if (state.refreshPromise) {
    return state.refreshPromise;
  }

  state.refreshPromise = (async () => {
    try {
      const catalog = await buildCatalog();
      state.catalog = catalog;
      state.lastError = null;
      return catalog;
    } catch (error) {
      state.lastError = error;
      throw error;
    } finally {
      state.refreshPromise = null;
    }
  })();

  return state.refreshPromise;
}

async function loadCatalog() {
  if (state.catalog) {
    return state.catalog;
  }

  const cached = await readCacheFile();
  if (cached) {
    state.catalog = cached;
    return cached;
  }

  return refreshCatalog();
}

function getCatalogSync() {
  return state.catalog;
}

async function ensureWarmCatalog() {
  if (!state.warmupPromise) {
    state.warmupPromise = loadCatalog().catch((error) => {
      state.lastError = error;
      return null;
    });
  }

  return state.warmupPromise;
}

function getArtworkById(id) {
  const catalog = state.catalog;
  if (!catalog) {
    return null;
  }

  return catalog.artworks.find((artwork) => artwork.id === String(id)) || null;
}

function getFilteredArtworks(query) {
  const catalog = state.catalog;
  if (!catalog) {
    return [];
  }

  return applyArtworksQuery(catalog.artworks, query);
}

async function getArtworkPalette(id) {
  const artwork = getArtworkById(id);
  if (!artwork) {
    return null;
  }

  const enriched = await enrichPalette(artwork);
  const catalog = state.catalog;
  const index = catalog.artworks.findIndex((item) => item.id === String(id));

  if (index >= 0) {
    catalog.artworks[index] = enriched;
    catalog.facets = computeFacets(catalog.artworks);
    await writeCacheFile(catalog);
  }

  return enriched.palette;
}

async function getOrRefreshCatalog() {
  if (state.catalog) {
    return state.catalog;
  }

  return loadCatalog();
}

async function getSummary() {
  const catalog = await getOrRefreshCatalog();

  return {
    updatedAt: catalog.updatedAt,
    source: catalog.source,
    totalArtworks: catalog.artworks.length,
    facets: catalog.facets,
    ready: true,
  };
}

async function getArtworksResponse(query) {
  const catalog = await getOrRefreshCatalog();
  const offset = Math.max(0, Number(query.offset || 0));
  const limit = Math.max(1, Math.min(2000, Number(query.limit || 1000)));
  const includePalette = String(query.includePalette || '').toLowerCase() === 'true';
  let sourceArtworks = catalog.artworks;

  // Prefer exported precomputed palettes for fast includePalette responses.
  if (includePalette) {
    const precomputed = await loadArtworksWithPalettes();
    if (Array.isArray(precomputed) && precomputed.length) {
      sourceArtworks = precomputed;
    }
  }

  const filtered = applyArtworksQuery(sourceArtworks, query);
  const slice = filtered.slice(offset, offset + limit);

  let items = slice;
  if (includePalette && sourceArtworks === catalog.artworks && extractColors) {
    items = await pool(slice, colorWorkers, enrichPalette);
  }

  return {
    items,
    meta: {
      total: filtered.length,
      offset,
      limit,
      returned: items.length,
      updatedAt: catalog.updatedAt,
    },
  };
}

async function getFacetsResponse() {
  const catalog = await getOrRefreshCatalog();
  return {
    updatedAt: catalog.updatedAt,
    facets: catalog.facets,
    totalArtworks: catalog.artworks.length,
  };
}

async function getArtworkResponse(id, includePalette = false) {
  const artwork = getArtworkById(id);
  if (!artwork) {
    return null;
  }

  if (!includePalette) {
    return artwork;
  }

  const palette = await getArtworkPalette(id);
  return {
    ...artwork,
    palette,
  };
}

async function loadArtworksWithPalettes() {
  if (Array.isArray(state.artworksWithPalettesCache)) {
    return state.artworksWithPalettesCache;
  }

  try {
    const raw = await fs.readFile(artworksWithPalettesPath, 'utf8');
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      state.artworksWithPalettesCache = parsed;
      return parsed;
    }

    if (parsed && Array.isArray(parsed.artworks)) {
      state.artworksWithPalettesCache = parsed.artworks;
      return parsed.artworks;
    }

    return null;
  } catch (error) {
    return null;
  }
}

async function getArtistPaletteNetwork(options = {}) {
  const minArtworks = Math.max(1, Number(options.minArtworks || 2));
  const maxArtists = Math.max(20, Math.min(1000, Number(options.maxArtists || 600)));
  const maxEdges = Math.max(50, Math.min(5000, Number(options.maxEdges || 1200)));

  // Try to load artworks from the exported file with palettes
  let artworks = await loadArtworksWithPalettes();
  
  // Fall back to catalog artworks if export file doesn't exist
  if (!artworks) {
    const catalog = await getOrRefreshCatalog();
    artworks = catalog.artworks;
  }

  const artistMap = new Map();

  for (const artwork of artworks) {
    const paletteColors = paletteToRgbColors(artwork.palette);
    if (!paletteColors.length) {
      continue;
    }

    const avgColor = averageRgb(paletteColors);
    if (!avgColor) {
      continue;
    }

    const names = Array.isArray(artwork.artistNames) && artwork.artistNames.length
      ? artwork.artistNames
      : ['Unknown artist'];

    const sampleArtwork = {
      id: artwork.id,
      title: artwork.title,
      imageUrl: artwork.image?.url || '',
      yearLabel: artwork.timeline?.label || '',
      collection: artwork.collection?.en || artwork.collection?.fi || artwork.collection?.sv || '',
    };

    for (const artistName of names) {
      const key = String(artistName || 'Unknown artist').trim() || 'Unknown artist';
      const entry = artistMap.get(key) || {
        id: key,
        label: key,
        artworkCount: 0,
        paletteCount: 0,
        paletteAccumulator: { r: 0, g: 0, b: 0 },
        artworks: [],
      };

      entry.artworkCount += 1;
      entry.paletteCount += 1;
      entry.paletteAccumulator.r += avgColor.r;
      entry.paletteAccumulator.g += avgColor.g;
      entry.paletteAccumulator.b += avgColor.b;

      if (entry.artworks.length < 6) {
        entry.artworks.push(sampleArtwork);
      }

      artistMap.set(key, entry);
    }
  }

  const artistNodes = Array.from(artistMap.values())
    .filter((entry) => entry.artworkCount >= minArtworks && entry.paletteCount > 0)
    .map((entry) => {
      const avgRgb = {
        r: Math.round(entry.paletteAccumulator.r / entry.paletteCount),
        g: Math.round(entry.paletteAccumulator.g / entry.paletteCount),
        b: Math.round(entry.paletteAccumulator.b / entry.paletteCount),
      };

      return {
        id: entry.id,
        label: entry.label,
        artworkCount: entry.artworkCount,
        avgRgb,
        avgHex: `#${[avgRgb.r, avgRgb.g, avgRgb.b]
          .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0'))
          .join('')
          .toUpperCase()}`,
        artworks: entry.artworks,
      };
    })
    .sort((a, b) => b.artworkCount - a.artworkCount)
    .slice(0, maxArtists);

  const edges = [];
  const maxDistance = Math.sqrt(255 * 255 * 3);

  for (let i = 0; i < artistNodes.length; i += 1) {
    const source = artistNodes[i];
    for (let j = i + 1; j < artistNodes.length; j += 1) {
      const target = artistNodes[j];
      const distance = rgbDistance(source.avgRgb, target.avgRgb);
      const similarity = 1 - distance / maxDistance;
      if (similarity < 0.65) {
        continue;
      }

      edges.push({
        source: source.id,
        target: target.id,
        similarity: Number(similarity.toFixed(4)),
        distance: Number(distance.toFixed(2)),
      });
    }
  }

  edges.sort((a, b) => b.similarity - a.similarity || a.distance - b.distance);

  const limitedEdges = edges.slice(0, maxEdges);
  const connected = new Set();
  for (const edge of limitedEdges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  const filteredNodes = artistNodes.filter((node) => connected.has(node.id));

  return {
    generatedAt: new Date().toISOString(),
    totalArtistsWithPalettes: artistNodes.length,
    totalEdges: limitedEdges.length,
    minArtworks,
    nodes: filteredNodes,
    links: limitedEdges,
  };
}

module.exports = {
  state,
  ensureWarmCatalog,
  refreshCatalog,
  getCatalogSync,
  getSummary,
  getArtworksResponse,
  getFacetsResponse,
  getArtworkResponse,
  getArtworkPalette,
  getFilteredArtworks,
  getArtistPaletteNetwork,
};