const path = require('path');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const backendRoot = path.resolve(__dirname, '..');

module.exports = {
  backendRoot,
  port: parseNumber(process.env.PORT, 3001),
  apiBaseUrl: process.env.FNG_API_BASE_URL || 'https://api.fng.fi',
  apiKey: process.env.FNG_API_KEY || '',
  collectionEndpoint:
    process.env.FNG_COLLECTION_ENDPOINT || 'https://api.fng.fi/api/collection',
  objectsEndpoint:
    process.env.FNG_OBJECTS_ENDPOINT ||
    'https://kokoelma.kansallisgalleria.fi/api/v1/objects',
  mediaBaseUrl:
    process.env.FNG_MEDIA_BASE_URL || 'https://kokoelma.kansallisgalleria.fi',
  extractColors: parseBoolean(process.env.FNG_EXTRACT_COLORS, true),
  colorWorkers: Math.max(1, parseNumber(process.env.FNG_COLOR_WORKERS, 8)),
  cachePath: path.join(backendRoot, 'data', 'catalog-cache.json'),
  artworksWithPalettesPath: path.join(backendRoot, 'data', 'artworks-with-palettes.json'),
};