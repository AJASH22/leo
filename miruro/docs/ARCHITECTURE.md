# Architecture

The plugin lives in [`miruro/plugin.js`](../miruro/plugin.js). It is a single self-contained
IIFE that follows the SkyStream plugin contract. This document maps its sections.

## Module map (top-to-bottom of `miruro/plugin.js`)

| Section                    | Responsibility                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| **CONFIG**                 | `BASE_URL`, `PROVIDERS`, `HEADERS`, `HASHES` (GraphQL persisted-query hashes).                       |
| **CACHE**                  | In-memory TTL cache + negative-result cache to prevent hammering failing sources.                    |
| **LOGGING**                | `log` / `logError` prefixed console helpers.                                                         |
| **GRAPHQL HELPERS**        | `encodeQueryParts`, `queryGraph`, `safeQueryGraph` — fire persisted-query GET/POST to AllAnime.      |
| **DATA HELPERS**           | Pure functions: `hasEpisodes`, `preferredTitle`, `resolvePosterUrl`, `getPosterFallback`,            |
|                            | `getStatusFromText`, `toMultimediaItem`, Jikan adapter.                                              |
| **METADATA ENRICHMENT**    | `getAniListMedia` (AniList GraphQL), `getAniZipData` (AniZip mappings), `getJikan` (REST fallback).  |
| **STREAM PIPELINE**        | `expandM3u8Streams`, `findMediaUrlsInHtml`, `resolveVidStackLike`, `resolveStreamWishLike`,          |
|                            | `resolveFilemoonLike`, `resolveDirectEmbed`, `resolveEmbeddedSource`, `resolveSourceEntries`.        |
| **PLUGIN FUNCTIONS**       | `getHome`, `search`, `load`, `loadStreams` — async, return data, wrapped in cb-style adapters.      |
| **EXPORT**                 | Assigns the four functions to `globalThis` for the SkyStream host.                                   |

## Data flow

```
                ┌────────────────────────────────────────────────────┐
                │ SkyStream app calls getHome() / search() / load()  │
                │ / loadStreams() with (arg, cb)                      │
                └──────────────────────┬─────────────────────────────┘
                                       │
                                       ▼
                ┌────────────────────────────────────────────────────┐
                │ Adapter wrapper in PLUGIN FUNCTIONS section:      │
                │   await _getHome() then cb({ success, data })      │
                └──────────────────────┬─────────────────────────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       │                               │                               │
       ▼                               ▼                               ▼
 AllAnime GraphQL             AniList GraphQL                  Jikan REST (fallback)
 (catalog + streams)          (metadata enrichment)            (catalog + search only)
       │                               │                               │
       └───────── merged into a single ─┴───────── merged into a single ┘
                          MultimediaItem

Streams: AllAnime → resolveSourceEntries → resolveEmbeddedSource
                                              ├── resolveVidStackLike
                                              ├── resolveStreamWishLike
                                              ├── resolveFilemoonLike
                                              └── resolveDirectEmbed
```

## Why callback wrappers?

The SkyStream CLI (`skystream test`) and host both call plugin functions as
`async function name(arg, cb)` and expect `cb({ success, data })`. The plugin
keeps the internal functions modern (`async`, return value) and the exports
are 4-line adapters. This makes the code easier to read and unit-test while
remaining wire-compatible.

## Caching strategy

- `metadata` (10 min) — AllAnime detail payloads.
- `search` (5 min) — search results.
- `home` (5 min) — home page.
- `stream_failed` (1 min) — negative cache for stream URLs that failed extraction so the
  pipeline doesn't re-walk the same dead hosts within a short window.

Max 200 entries; oldest 20% are evicted on overflow.

## Failure handling

- Cloudflare challenges surface as `CLOUDFLARE_BLOCK` and trigger the Jikan fallback for
  catalog/search (streams still need a working AllAnime — no real fallback there yet).
- GraphQL `PERSISTED_QUERY_NOT_FOUND` / `AA_CRYPTO_MISSING` are handled by re-issuing the
  query as a raw text query (see `loadStreams`).
- M3U8 variants are expanded into separate `StreamResult` entries with quality labels.
