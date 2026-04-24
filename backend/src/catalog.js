const fs = require('fs/promises');
const path = require('path');
const { cachePath, objectsEndpoint, mediaBaseUrl, extractColors, colorWorkers } = require('./env');
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
};

const exportedArtworksPath = path.join(__dirname, '..', 'data', 'artworks-with-palettes.json');

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

async function readExportedArtworks() {
  try {
    const raw = await fs.readFile(exportedArtworksPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.artworks)) {
      return null;
    }
    return parsed.artworks;
  } catch (error) {
    return null;
  }
}

async function getArtworksForPaletteAnalytics() {
  const catalog = await getOrRefreshCatalog();
  const catalogArtworks = Array.isArray(catalog?.artworks) ? catalog.artworks : [];
  const catalogWithPalette = catalogArtworks.filter(
    (artwork) => Array.isArray(artwork.palette) && artwork.palette.length
  );

  if (catalogWithPalette.length >= 100) {
    return {
      source: 'catalog-cache',
      artworks: catalogArtworks,
    };
  }

  const exported = await readExportedArtworks();
  if (exported && exported.length) {
    return {
      source: 'exported-json',
      artworks: exported,
    };
  }

  return {
    source: 'catalog-cache',
    artworks: catalogArtworks,
  };
}

function extractDominantRgb(artwork) {
  const paletteColors = paletteToRgbColors(artwork.palette);
  if (!paletteColors.length) {
    return null;
  }
  return paletteColors[0];
}

function rgbToHue(rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) {
    return 0;
  }
  let hue;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  const degrees = hue * 60;
  return degrees < 0 ? degrees + 360 : degrees;
}

function hueToRepresentativeHex(index, saturation = 72, lightness = 52) {
  const hue = index * 30;
  const c = (1 - Math.abs(2 * (lightness / 100) - 1)) * (saturation / 100);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness / 100 - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hue < 60) {
    r1 = c;
    g1 = x;
  } else if (hue < 120) {
    r1 = x;
    g1 = c;
  } else if (hue < 180) {
    g1 = c;
    b1 = x;
  } else if (hue < 240) {
    g1 = x;
    b1 = c;
  } else if (hue < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function quantizeArtworkPaletteToHueBins(artwork) {
  const colors = paletteToRgbColors(artwork.palette);
  if (!colors.length) {
    return [];
  }

  const bins = new Set();
  for (const rgb of colors.slice(0, 5)) {
    const hue = rgbToHue(rgb);
    const index = Math.min(11, Math.floor(hue / 30));
    bins.add(index);
  }

  return Array.from(bins);
}

function summarizeInsights(artworks) {
  const artistCounts = new Map();
  const decadeCounts = new Map();
  const collectionCounts = new Map();
  const hueBins = Array.from({ length: 12 }, (_, i) => ({
    label: `${i * 30}-${i * 30 + 29}`,
    count: 0,
  }));

  for (const artwork of artworks) {
    const names = Array.isArray(artwork.artistNames) && artwork.artistNames.length
      ? artwork.artistNames
      : ['Unknown artist'];
    for (const name of names) {
      artistCounts.set(name, (artistCounts.get(name) || 0) + 1);
    }

    const year = artwork.timeline?.yearFrom ?? artwork.timeline?.yearTo ?? artwork.timeline?.acquisitionYear;
    if (Number.isFinite(year)) {
      const decade = Math.floor(year / 10) * 10;
      decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
    }

    const collection = artwork.collection?.en || artwork.collection?.fi || artwork.collection?.sv || 'Unknown collection';
    collectionCounts.set(collection, (collectionCounts.get(collection) || 0) + 1);

    const dominant = extractDominantRgb(artwork);
    if (dominant) {
      const hue = rgbToHue(dominant);
      const index = Math.min(11, Math.floor(hue / 30));
      hueBins[index].count += 1;
    }
  }

  const topArtists = Array.from(artistCounts.entries())
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const byDecade = Array.from(decadeCounts.entries())
    .map(([decade, count]) => ({ decade: Number(decade), count }))
    .sort((a, b) => a.decade - b.decade);

  const topCollections = Array.from(collectionCounts.entries())
    .map(([collection, count]) => ({ collection, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    topArtists,
    byDecade,
    topCollections,
    hueBins,
  };
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
  const limit = Math.max(1, Math.min(2000, Number(query.limit || 1000)));
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

async function getArtistPaletteNetwork(options = {}) {
  const minArtworks = Math.max(1, Number(options.minArtworks || 2));
  const maxArtists = Math.max(20, Math.min(1000, Number(options.maxArtists || 600)));
  const maxEdges = Math.max(50, Math.min(5000, Number(options.maxEdges || 1200)));

  const artworkSource = await getArtworksForPaletteAnalytics();
  const artworks = artworkSource.artworks;
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
    dataSource: artworkSource.source,
    totalArtistsWithPalettes: artistNodes.length,
    totalEdges: limitedEdges.length,
    minArtworks,
    nodes: filteredNodes,
    links: limitedEdges,
  };
}

async function getInsightsSummary() {
  const artworkSource = await getArtworksForPaletteAnalytics();
  const summary = summarizeInsights(artworkSource.artworks);
  return {
    generatedAt: new Date().toISOString(),
    dataSource: artworkSource.source,
    totalArtworks: artworkSource.artworks.length,
    ...summary,
  };
}

async function getColorNetworkSummary(options = {}) {
  const maxArtists = Math.max(10, Math.min(120, Number(options.maxArtists || 30)));
  const artworkSource = await getArtworksForPaletteAnalytics();
  const artworks = artworkSource.artworks;

  const colorCounts = Array.from({ length: 12 }, (_, index) => ({
    id: `H${index}`,
    hueIndex: index,
    label: `${index * 30}-${index * 30 + 29}`,
    count: 0,
    color: hueToRepresentativeHex(index),
  }));

  const edgeMap = new Map();
  const artistCounts = new Map();
  const artistColorMap = new Map();

  for (const artwork of artworks) {
    const bins = quantizeArtworkPaletteToHueBins(artwork);
    if (!bins.length) {
      continue;
    }

    for (const bin of bins) {
      colorCounts[bin].count += 1;
    }

    for (let i = 0; i < bins.length; i += 1) {
      for (let j = i + 1; j < bins.length; j += 1) {
        const a = Math.min(bins[i], bins[j]);
        const b = Math.max(bins[i], bins[j]);
        const key = `${a}-${b}`;
        edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
      }
    }

    const names = Array.isArray(artwork.artistNames) && artwork.artistNames.length
      ? artwork.artistNames
      : ['Unknown artist'];

    for (const name of names) {
      const artist = String(name || 'Unknown artist').trim() || 'Unknown artist';
      artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
      const artistBins = artistColorMap.get(artist) || new Map();
      for (const bin of bins) {
        artistBins.set(bin, (artistBins.get(bin) || 0) + 1);
      }
      artistColorMap.set(artist, artistBins);
    }
  }

  const colorNodes = colorCounts.filter((node) => node.count > 0);
  const colorLinks = Array.from(edgeMap.entries())
    .map(([key, weight]) => {
      const [a, b] = key.split('-').map(Number);
      return {
        source: `H${a}`,
        target: `H${b}`,
        weight,
      };
    })
    .sort((x, y) => y.weight - x.weight)
    .slice(0, 180);

  const topArtists = Array.from(artistCounts.entries())
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxArtists);

  const matrix = topArtists.map(({ artist, count }) => {
    const bins = artistColorMap.get(artist) || new Map();
    const colors = Array.from({ length: 12 }, (_, index) => ({
      hueIndex: index,
      hueLabel: `${index * 30}-${index * 30 + 29}`,
      count: bins.get(index) || 0,
      ratio: count ? Number(((bins.get(index) || 0) / count).toFixed(4)) : 0,
    }));
    return {
      artist,
      artworkCount: count,
      colors,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    dataSource: artworkSource.source,
    totalArtworks: artworks.length,
    colorNodes,
    colorLinks,
    artistColorMatrix: matrix,
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
  getInsightsSummary,
  getColorNetworkSummary,
};