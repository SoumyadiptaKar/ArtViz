# Frontend

This frontend mimics the Art Palette browsing workflow while using the local backend data.

## Features

- Reads palette from URL hash like `#colors/2f403d-e9e6d9-b4533a-9b9270-ddbd67`
- Palette editor with add/remove color controls
- Fetches filtered artworks from backend and ranks by palette similarity
- Hero artwork preview and matched artwork list
- Buttons to search an artwork's own palette and open external detail pages

## Run

1. Start backend:

```bash
cd backend
npm start
```

2. Serve frontend (from repository root):

```bash
cd frontend
python3 -m http.server 5173
```

3. Open:

- `http://localhost:5173`
- or `http://localhost:5173/#colors/2f403d-e9e6d9-b4533a-9b9270-ddbd67`
