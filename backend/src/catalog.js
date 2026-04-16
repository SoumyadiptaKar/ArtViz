const fs = require('fs/promises');
const path = require('path');
const { cachePath, objectsEndpoint, mediaBaseUrl, extractColors, colorWorkers } = require('./env');
const { normalizeArtwork, filterPaintings, applyArtworksQuery, computeFacets } = require('./filter');
const { extractPaletteFromImageUrl } = require('./palette');

const state = {
  catalog: null,
  refreshPromise: null,
  warmupPromise: null,
  lastError: null,
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
  const filtered = applyArtworksQuery(catalog.artworks, query);
  const offset = Math.max(0, Number(query.offset || 0));
  const limit = Math.max(1, Math.min(250, Number(query.limit || 50)));
  const includePalette = String(query.includePalette || '').toLowerCase() === 'true';
  const slice = filtered.slice(offset, offset + limit);

  let items = slice;
  if (includePalette && extractColors) {
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
};