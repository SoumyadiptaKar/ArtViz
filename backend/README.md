# Backend

This backend loads public objects from the Finnish National Gallery API, filters the dataset down to painting-like artworks with images, and caches normalized records locally.

## What it stores

- artwork title and localized title variants
- artist names and structured people data
- timeline fields such as `yearFrom`, `yearTo`, `acquisitionYear`, and `dateFrom`
- materials, classifications, keywords, dimensions, collections, and exhibitions
- primary image metadata and image URL
- optional extracted color palette data

## Filtering

The cache intentionally excludes records that look like sketches, pencil drawings, print-based works, posters, photographs, and other non-painting graphic arts.

## Endpoints

- `GET /health`
- `GET /api/status`
- `POST /api/refresh`
- `GET /api/facets`
- `GET /api/artworks`
- `GET /api/artworks/:id`
- `GET /api/artworks/:id/palette`

## Environment

The service reads `backend/.env` for:

- `FNG_API_BASE_URL`
- `FNG_API_KEY`
- `FNG_COLLECTION_ENDPOINT`
- `FNG_OBJECTS_ENDPOINT`
- `FNG_MEDIA_BASE_URL`
- `FNG_EXTRACT_COLORS`
- `FNG_COLOR_WORKERS`

Run it with:

```bash
cd backend
npm install
npm start
```