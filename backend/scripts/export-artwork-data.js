const fs = require('fs/promises');
const path = require('path');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const PAGE_SIZE = 2000;

async function fetchPage(offset) {
  const url = new URL('/api/artworks', API_BASE);
  url.searchParams.set('includePalette', 'true');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(offset));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Export fetch failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function main() {
  const artworks = [];
  let offset = 0;
  let total = null;

  while (total === null || offset < total) {
    const payload = await fetchPage(offset);
    const items = Array.isArray(payload.items) ? payload.items : [];

    if (total === null) {
      total = payload.meta?.total ?? items.length;
    }

    artworks.push(...items);
    offset += items.length;

    if (!items.length) {
      break;
    }
  }

  const output = {
    exportedAt: new Date().toISOString(),
    source: API_BASE,
    totalArtworks: artworks.length,
    artworks,
  };

  const outputPath = path.join(__dirname, '..', 'data', 'artworks-with-palettes.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Exported ${artworks.length} artworks to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});