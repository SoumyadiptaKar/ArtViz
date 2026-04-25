const http = require('http');
const querystring = require('querystring');
const { port } = require('./env');
const {
  state,
  ensureWarmCatalog,
  refreshCatalog,
  getSummary,
  getArtworksResponse,
  getFacetsResponse,
  getArtworkResponse,
  getArtworkPalette,
  getArtistPaletteNetwork,
} = require('./catalog');
const { extractPaletteFromBuffer } = require('./palette');

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });

  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });

  res.end(text);
}

function readPathAndQuery(urlString) {
  const requestUrl = new URL(urlString, 'http://localhost');
  return {
    pathname: requestUrl.pathname,
    searchParams: requestUrl.searchParams,
  };
}

function toQueryObject(searchParams) {
  const query = {};
  for (const [key, value] of searchParams.entries()) {
    if (query[key] === undefined) {
      query[key] = value;
    } else if (Array.isArray(query[key])) {
      query[key].push(value);
    } else {
      query[key] = [query[key], value];
    }
  }
  return query;
}

async function handleRequest(req, res) {
  const { pathname, searchParams } = readPathAndQuery(req.url || '/');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  try {
    if (pathname === '/health') {
      const catalog = state.catalog;
      sendJson(res, 200, {
        ok: true,
        ready: Boolean(catalog),
        refreshing: Boolean(state.refreshPromise),
        lastError: state.lastError ? state.lastError.message : null,
      });
      return;
    }

    if (pathname === '/api/status') {
      const summary = await getSummary();
      sendJson(res, 200, summary);
      return;
    }

    if (pathname === '/api/refresh' && req.method === 'POST') {
      const catalog = await refreshCatalog();
      sendJson(res, 200, {
        ok: true,
        updatedAt: catalog.updatedAt,
        totalArtworks: catalog.artworks.length,
        facets: catalog.facets,
      });
      return;
    }

    if (pathname === '/api/palette/extract' && req.method === 'POST') {
      let body = Buffer.alloc(0);
      req.on('data', (chunk) => {
        body = Buffer.concat([body, chunk]);
        if (body.length > 10 * 1024 * 1024) {
          // 10MB limit
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          req.socket.destroy();
        }
      });

      req.on('end', async () => {
        try {
          const palette = await extractPaletteFromBuffer(body, { colorCount: 5 });
          sendJson(res, 200, { palette });
        } catch (error) {
          sendJson(res, 400, { error: error.message || 'Failed to extract palette' });
        }
      });

      req.on('error', (error) => {
        sendJson(res, 400, { error: error.message });
      });
      return;
    }

    if (pathname === '/api/facets') {
      const facets = await getFacetsResponse();
      sendJson(res, 200, facets);
      return;
    }

    if (pathname === '/api/network' && req.method === 'GET') {
      const query = toQueryObject(searchParams);
      const payload = await getArtistPaletteNetwork(query);
      sendJson(res, 200, payload);
      return;
    }

    if (pathname === '/api/artworks' && req.method === 'GET') {
      const response = await getArtworksResponse(toQueryObject(searchParams));
      sendJson(res, 200, response);
      return;
    }

    if (pathname.startsWith('/api/artworks/') && req.method === 'GET') {
      const suffix = pathname.slice('/api/artworks/'.length);
      const [idPart, extraPart] = suffix.split('/');
      const id = decodeURIComponent(idPart || '');
      const includePalette = searchParams.get('includePalette') === 'true';

      if (extraPart === 'palette') {
        const palette = await getArtworkPalette(id);
        if (!palette) {
          sendJson(res, 404, { error: 'Artwork not found' });
          return;
        }

        sendJson(res, 200, { id, palette });
        return;
      }

      const artwork = await getArtworkResponse(id, includePalette);
      if (!artwork) {
        sendJson(res, 404, { error: 'Artwork not found' });
        return;
      }

      sendJson(res, 200, artwork);
      return;
    }

    if (pathname === '/' || pathname === '/api') {
      sendJson(res, 200, {
        service: 'InteractiveDataViz backend',
        endpoints: [
          '/health',
          '/api/status',
          '/api/refresh',
          '/api/palette/extract',
          '/api/network',
          '/api/facets',
          '/api/artworks',
          '/api/artworks/:id',
          '/api/artworks/:id/palette',
        ],
      });
      return;
    }

    sendText(res, 404, 'Not Found');
  } catch (error) {
    sendJson(res, 500, {
      error: 'Internal Server Error',
      message: error.message,
    });
  }
}

async function main() {
  ensureWarmCatalog().catch(() => {
    // Catalog warmup is best effort. The service stays up and can refresh later.
  });

  const server = http.createServer(handleRequest);

  server.listen(port, () => {
    console.log(`InteractiveDataViz backend listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});