# Architecture

`miruro/plugin.js` is a single SkyStream plugin bundle. It exposes callback-compatible
`getHome`, `search`, `load`, and `loadStreams` functions while keeping the implementation in
modern async helpers.

## Module map

| Section | Responsibility |
| --- | --- |
| **CONFIG** | Provider registry, preferences, headers, settings, and AllAnime hashes. |
| **CACHE** | TTL cache for metadata/catalog and a short negative stream cache. |
| **GRAPHQL HELPERS** | AllAnime persisted-query GET/POST and response validation. |
| **DATA HELPERS** | Anime-only guards, source-aware ID envelopes, URL/title/status normalization, and provider mappers. |
| **METADATA ENRICHMENT** | AniList GraphQL and AniZip episode mapping; Jikan, Kitsu, and HiAnime adapters. |
| **STREAM PIPELINE** | Source normalization, bundled/runtime extractors, host adapters, direct media validation, and HLS expansion. |
| **PLUGIN FUNCTIONS** | Provider failover for home/search, source-aware detail/episode loading, and stream dispatch. |
| **EXPORT** | Assigns the four public functions to `globalThis`. |

## Provider flow

```text
SkyStream
  │
  ├─ getHome/search
  │    └─ preferred provider → AllAnime → Jikan → Kitsu → optional HiAnime
  │         └─ anime-only filtering → dedupe by MAL/AniList/title+year
  │
  ├─ load(source-aware item id)
  │    ├─ AllAnime detail + AniList + AniZip
  │    ├─ HiAnime detail + episodes
  │    └─ Jikan/Kitsu fallback detail
  │
  └─ loadStreams(source-aware episode id)
       ├─ HiAnime source endpoint
       ├─ AllAnime GraphQL server endpoint
       ├─ metadata id → AniList title → AllAnime routing
       └─ extractor registry → direct media validation → HLS variants
```

## Anime-only contract

`isAnimeRecord` rejects manga-shaped fields and explicit non-video formats before mapping. This is
applied to provider data, home sections, search results, and detail responses. A source-aware ID
contains `v: 2`, its provider name, the provider ID, optional MAL/AniList IDs, episode, and dub
status. Legacy AllAnime payloads are accepted for existing cached episodes.

## Metadata model

AllAnime/Jikan/Kitsu/HiAnime provide the base `MultimediaItem`. AniList enriches details with
alternate titles, banner/cover, format, tags, studios, characters and voice actors, trailer,
recommendations, relations, score, and next airing. AniZip fills per-episode title, overview,
runtime, date, and image when a MAL ID exists. Provenance remains in `syncData`.

## Stream safety and reliability

- Only URLs matching HLS/DASH/MP4/WebM patterns (or known playlist/manifest query forms) are
  accepted as playable media.
- Relative links are resolved against the provider response URL.
- Runtime extractors are preferred; if the host exposes the optional extractor registry, supported
  Dood/Filemoon/HubCloud/MixDrop/RabbitStream/StreamSB/StreamTape/StreamWish/VidHidePro/Voe
  implementations are dispatched by hostname.
- Extractors preserve referer and subtitle data and expand HLS master playlists into quality
  variants where possible.
- Failed hosts are negatively cached for one minute; a dead host does not permanently poison an
  episode.
- A raw iframe URL is never returned as a playable stream.

## Caching

- Metadata: 10 minutes.
- Search/home: 5 minutes.
- Failed stream entries: 1 minute.
- Maximum 200 entries, evicting the oldest 20% when full.
