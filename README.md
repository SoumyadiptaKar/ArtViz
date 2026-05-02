# Interactive Data Viz

Interactive Data Viz is a Finnish art exploration prototype built around color palettes, artwork metadata, and artist relationships. The project includes a palette-based artwork explorer, an artist similarity network, a dashboard of summary charts, and a ColorNet-inspired multi-panel lab view.

## What the project includes

- `frontend/index.html` - main palette explorer for searching artworks by color and metadata.
- `frontend/network.html` - artist palette network that links artists by color similarity.
- `frontend/insights.html` - summary dashboard with charts for artists, years, hue distribution, and collections.
- `frontend/colornet.html` - ColorNet-style explorer with color network and matrix views.
- `frontend/colornetvis.html` - experimental ColorNetVis-inspired lab page.

The backend provides artwork APIs, palette extraction, and artist network summaries based on Finnish National Gallery data.

## Project structure

```text
InteractiveDataViz/
├── backend/
│   ├── src/
│   ├── data/
│   ├── scripts/
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── *.html
│   ├── *.js
│   ├── *.css
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml
├── user-study-report.txt
└── README.md
```

## Requirements

For local development:

- Node.js 22 or newer
- npm
- Python 3.9+ for a simple static frontend server

For containerized deployment:

- Docker
- Docker Compose v2

## Local run

The project runs as two parts locally:

- Backend API on port `3001`
- Frontend static server on port `8000`

### 1. Install backend dependencies

```bash
cd backend
npm install
```

### 2. Start the backend

```bash
cd backend
npm start
```

This starts the Node.js server and loads the artwork catalog. The backend reads the bundled `backend/data/artworks-with-palettes.json` file when available, which keeps the graph and palette views working without needing to re-fetch everything from the remote API.

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
python3 -m http.server 8000
```

### 4. Open the application

- Main explorer: `http://localhost:8000/`
- Artist network: `http://localhost:8000/network.html`
- Insights dashboard: `http://localhost:8000/insights.html`
- ColorNet view: `http://localhost:8000/colornet.html`
- ColorNetVis lab: `http://localhost:8000/colornetvis.html`

## Docker run

The repository includes a Dockerized setup with a reverse proxy so the browser can use the same origin for the frontend and API.

### 1. Build and start everything

```bash
docker compose up --build
```

### 2. Open the app

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:3001`

The frontend container serves the static pages through Nginx and proxies `/api/*` requests to the backend container.

### 3. Stop the stack

```bash
docker compose down
```

## What each view does

### Palette Explorer

The main view lets you build or edit a palette, search by artist or keyword, and see artworks ranked by palette similarity. It is the starting point for browsing artworks through color.

### Artist Palette Network

This view shows a force-directed artist graph. Artists are connected when their average artwork palettes are visually close. Controls let you change the minimum artworks per artist, similarity threshold, maximum artists, and a target color for matching.

### Insights Dashboard

This page summarizes the collection with charts for top artists, timeline, hue distribution, and collections. It is useful for overview analysis and comparison.

### ColorNet View

This view provides a color network and matrix-style analysis inspired by ColorNetVis ideas. It is meant for exploring color co-occurrence, artist-color relationships, and aggregated structure.

### ColorNetVis Lab

This is a more experimental multi-panel exploration page with network, heatmap, color space, tree, treemap, and sankey-style views.

## Data and backend behavior

The backend is in `backend/src/server.js` and `backend/src/catalog.js`. It exposes endpoints for artworks, facets, palette extraction, and network summaries.

Useful endpoints:

- `GET /health`
- `GET /api/status`
- `POST /api/refresh`
- `GET /api/facets`
- `GET /api/artworks`
- `GET /api/artworks/:id`
- `GET /api/artworks/:id/palette`
- `GET /api/network`
- `GET /api/palette/extract`

The project also includes the exported dataset `backend/data/artworks-with-palettes.json`, which stores pre-computed palettes for the prototype and keeps the graph views responsive.

## Frontend API configuration

The frontend automatically uses:

- `http://localhost:3001` when opened from the local static server on port `8000`
- `/api` when served behind the Docker/Nginx reverse proxy

This makes the same frontend code work for both local development and cloud deployment.

## Cloud deployment notes

To run this in the cloud, deploy the Docker Compose stack on a VM or container host that supports Docker. Expose the frontend port `8080` to the internet, or update `docker-compose.yml` if you want to publish the frontend on a different host port.

If you want to use a managed platform, the simplest approach is:

1. Build the backend container from `backend/Dockerfile`.
2. Build the frontend container from `frontend/Dockerfile`.
3. Keep the backend reachable from the frontend through the `/api` reverse proxy.

## Helpful commands

```bash
# Backend only
cd backend
npm start

# Frontend only
cd frontend
python3 -m http.server 8000

# Docker stack
docker compose up --build

# Stop Docker stack
docker compose down
```

## Troubleshooting

- If the network is empty, make sure the backend has loaded `backend/data/artworks-with-palettes.json` and that the backend is running on port `3001`.
- If the frontend cannot reach the API in local development, confirm you opened it from `http://localhost:8000`.
- If Docker Compose fails, verify that Docker Desktop or the Docker daemon is running.
- If a port is already in use, stop the process using that port or change the port mapping in `docker-compose.yml`.

## Related files

- `user-study-report.txt` contains the study report draft for the project evaluation.
- `project-log.txt` contains development notes and change history.
