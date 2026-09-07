# Upstream APIs

Miruro is anime-only. Every provider result is filtered for video media before it reaches a
SkyStream `MultimediaItem`; manga, manhwa, manhua, comic, novel, and similar records are rejected.

## Catalog and metadata providers

### AllAnime GraphQL (primary)

- **Endpoint:** `https://api.allanime.day/api`
- **Method:** GET with `variables` + `extensions` URL parameters, or POST.
- **Headers:** `HEADERS` in `miruro/plugin.js` (`app-version`, `from-app`, and `platformstr` are
  needed by the current API).
- **Persisted hashes:** `HASHES.mainPage` for home/search, `HASHES.detail` for detail, and
  `HASHES.server` for episode sources. AllAnime can rotate these hashes; update them when the
  upstream bundle changes.
- **Failure behavior:** Cloudflare or API failure falls through to Jikan/Kitsu for catalog work.

### Jikan (MAL fallback)

- **Endpoint:** `https://api.jikan.moe/v4`
- **Used for:** anime home/search/detail and MAL metadata.
- **Endpoints:** `/top/anime`, `/top/anime?filter=airing`, `/seasons/upcoming`,
  `/anime?q=...`, `/anime/{mal_id}/full`.
- **Rate limit:** approximately 2 requests/second and 60 requests/minute. Results are cached.
- **Streams:** Jikan has no stream URLs. A Jikan episode envelope may be resolved by finding the
  corresponding AllAnime title, then using AllAnime's episode API.

### Kitsu

- **Endpoint:** `https://kitsu.io/api/edge`
- **Used for:** anime search and popular catalog fallback.
- **Examples:** `/anime?filter[text]=naruto&page[limit]=25`,
  `/anime?page[limit]=20&sort=-averageRating`.
- **Format:** JSON:API resources under `data`; only the `anime` collection is queried.
- **Streams:** Kitsu is metadata-only. Episode streams require an available stream provider.

### Optional self-hosted HiAnime API

Configure `hiAnimeBaseUrl` in the plugin settings. The adapter expects the documented `/api/v2`
shape and does not depend on a public third-party deployment:

- `GET /api/v2/home`
- `GET /api/v2/search?keyword=...&page=1`
- `GET /api/v2/anime/:id`
- `GET /api/v2/episodes/:id`
- `GET /api/v2/sources?animeId=:id&episodeId=:episodeId&type=sub|dub` (when implemented by the deployment)

## Metadata enrichment

- **AniList:** `https://graphql.anilist.co` for titles, descriptions, images, format, tags, score,
  staff, characters/voice actors, trailer, recommendations, relations, and next airing data.
- **AniZip:** `https://api.ani.zip/mappings?mal_id={id}` for episode titles, overviews, runtime,
  air dates, images, and filler metadata.

## Source-aware IDs

New item and episode URLs contain a versioned JSON envelope:

```json
{
  "v": 2,
  "source": "allanime|jikan|kitsu|hianime|anilist",
  "id": "provider-id",
  "malId": 123,
  "anilistId": 456,
  "episode": "1",
  "dubStatus": "sub"
}
```

The parser remains backward-compatible with legacy AllAnime IDs and `{hash, episode, dubStatus}`
objects. Keeping the source in the envelope prevents Jikan/Kitsu IDs from being sent directly to
an incompatible episode endpoint.

## Stream resolution

AllAnime episode responses expose `sourceUrls`. Miruro normalizes object and array variants,
resolves relative URLs, and emits only direct HLS/DASH/MP4/WebM media URLs. An iframe/embed URL
is never returned as a `StreamResult` by itself.

Resolution order:

1. Runtime `loadExtractor`, when provided by SkyStream.
2. Optional host extractor registry when supplied by the SkyStream runtime (the source project
   supports Dood, Filemoon, HubCloud, MixDrop, RabbitStream, StreamSB, StreamTape, StreamWish,
   VidHidePro, and Voe).
3. Built-in host adapters for AllAnime/VidStack, StreamWish, Filemoon, and known direct hosts.
4. Direct playable URLs and HLS master playlist expansion.

Extractor links preserve source labels, quality, subtitles, and referer headers where available.
