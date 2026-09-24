# ReAnime SkyStream Plugin

Direct API-based plugin for ReAnime (reanime.to) streaming catalog.

## Features
- **Real catalog** from ReAnime REST API (`/api/v1/home`, `/api/v1/search`, `/api/v1/anime/:slug`)
- **Home sections**: Latest Airing, New on Site, Trending, Upcoming
- **Search** with pagination support
- **Load** detailed anime info including subtitles
- **LoadStreams** via Flixcloud endpoint (`/api/flix/:anilistId/:episode`)

## API Endpoints Used
- `GET https://reanime.to/api/v1/home` — home sections
- `GET https://reanime.to/api/v1/search?q=<query>&page=1` — search
- `GET https://reanime.to/api/v1/anime/<slug>` — anime details
- `GET https://reanime.to/api/flix/<anilistId>/<episode>` — stream sources

## SkyStream Contract
Exports four async functions:
- `getHome(cb)` — returns `{ success: true, data: { sectionTitle: MultimediaItem[] } }`
- `search(query, cb)` — returns `{ success: true, data: MultimediaItem[] }`
- `load(url, cb)` — returns `{ success: true, data: MultimediaItem }`
- `loadStreams(url, cb)` — returns `{ success: true, data: StreamResult[] }`

## Testing
```bash
skystream test -p reanime -f getHome
skystream test -p reanime -f search -q "red river"
skystream test -p reanime -f load -q "https://reanime.to/anime/red-river-nb73wr"
skystream test -p reanime -f loadStreams -q "https://reanime.to/anime/red-river-nb73wr?ep=1"
```

## Notes
- Uses `http_get` provided by SkyStream sandbox
- Requires `http_get` to be available in execution context
- No external dependencies
- All errors return SkyStream-compatible error envelopes with `errorCode`