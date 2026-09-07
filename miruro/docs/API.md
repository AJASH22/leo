# Upstream APIs

The plugin talks to four upstream services. All endpoints and contracts are listed here so
that hash / endpoint changes are easy to track.

## 1. AllAnime GraphQL (primary)

- **Endpoint:** `https://api.allanime.day/api`
- **Method:** GET (default) with `variables` + `extensions` URL params, or POST.
- **Headers:** see `HEADERS` in `miruro/plugin.js`. The `app-version`, `from-app`,
  `platformstr` headers are required; Cloudflare blocks requests without them.
- **Persisted query hashes** (`HASHES` in source):

  | Hash name        | SHA-256 (truncated)          | Used by       |
  | ---------------- | ---------------------------- | ------------- |
  | `mainPage`       | `a24c500a1b765c68...`        | search, home  |
  | `popular`        | `60f50b84bb545fa2...`        | (reserved)    |
  | `detail`         | `bb263f91e5bdd048...`        | `load()`      |
  | `server`         | `d405d0edd690624b...`        | `loadStreams` |
  | `main`           | `e42a4466d984b2c0...`        | (reserved)    |
  | `showsMetadata`  | `9de1b73e302fa5e4...`        | (reserved)    |

  > Hashes are SHA-256s of the persisted-query body that AllAnime serves from
  > `/_next/static/chunks/pages/_app-*.js`. If the app bundle changes, hashes must be
  > refreshed. Search GitHub issues for "AllAnime api hash" if hashes go stale.

- **Rate limit:** none documented; aggressive use triggers Cloudflare 403 / JS challenge.
  Cache layer (see `ARCHITECTURE.md`) is the main defense.

## 2. AniList GraphQL (metadata enrichment)

- **Endpoint:** `https://graphql.anilist.co`
- **Used for:** high-quality metadata that AllAnime lacks — banner image, full description,
  genres, score, characters/cast, recommendations, status, episode count, next airing.
- **Rate limit:** 90 req / minute per IP. The cache layer keeps us well under it.
- **Schema fields used:** see `ANILIST_QUERY` in `miruro/plugin.js`.

## 3. AniZip (episode metadata)

- **Endpoint:** `https://api.ani.zip/mappings?mal_id={id}`
- **Used for:** per-episode titles, overviews, runtimes, air dates, thumbnails.
- **Free, no auth.**

## 4. Jikan (fallback)

- **Endpoint:** `https://api.jikan.moe/v4`
- **Used for:** home + search when AllAnime is blocked by Cloudflare. Provides a slightly
  thinner catalog (no per-show images as detailed) but stable.
- **Rate limit:** 60 req / minute, 2 req / second burst. The plugin respects this by only
  calling Jikan when AllAnime fails.
- **Endpoints used:** `GET /top/anime`, `GET /anime?q=...`, `GET /anime/{id}`.

## Stream resolution

Stream URLs come from AllAnime's `episode.sourceUrls` payload. The shape is:

```json
{
  "sourceUrl": "/api/v1/...json",        // relative — must be resolved against api.allanime.day
  "sourceName": "VidStreaming",          // provider label
  "priority": 1,
  "type": "sub" | "dub",
  "subtitles": [{ "lang": "en", "url": "..." }],
  "resolutionStr": "1080p",
  "hls": true
}
```

Absolute URLs are dispatched to a provider-specific resolver:

| Host pattern                       | Resolver               |
| ---------------------------------- | ---------------------- |
| `allanime.uns.bio`, `server1.uns.bio` | `resolveVidStackLike` (AES-CBC) |
| `bysekoze.com`, `byse.sx`          | `resolveVidStackLike`  |
| `mwish` / `dwish` / `swish`        | `resolveStreamWishLike` (jwplayer) |
| `filemoon`                         | `resolveFilemoonLike` (packed)  |
| `vidstreaming`, `mp4upload`, `ok.ru`, `streamsb` | `resolveDirectEmbed`  |
| anything else                      | `globalThis.loadExtractor` if present, else `resolveDirectEmbed` |

Each resolver returns its results as `StreamResult({ url, source, quality, headers })`.
