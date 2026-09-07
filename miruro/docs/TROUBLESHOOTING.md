# Troubleshooting

## Empty AllAnime results or Cloudflare block

**Symptom:** logs contain `CLOUDFLARE_BLOCK`, or AllAnime home/search is empty.

**Cause:** AllAnime returned an HTTP challenge instead of JSON, or its persisted query hash changed.

**Mitigation:** catalog requests automatically continue through Jikan and Kitsu. Select a specific
provider mode in extension settings if you want deterministic fallback behavior. Streams from an
AllAnime episode still require either an available AllAnime response or a configured HiAnime API.

## HiAnime returns no episodes or sources

**Checklist:**

1. Set `hiAnimeBaseUrl` to your own deployment origin, without a trailing slash.
2. Confirm `/api/v2/home`, `/api/v2/anime/:id`, and `/api/v2/episodes/:id` return JSON.
3. Confirm the deployment implements `/api/v2/sources` for stream resolution.
4. Keep provider mode on `auto` to let catalog work even when HiAnime is offline.

The plugin does not assume a public HiAnime instance, so an empty setting is expected by default.

## Jikan/Kitsu detail fails during a smoke test

These sources are external metadata services and can be temporarily rate-limited or unreachable.
Use a numeric MAL id for a Jikan detail test, keep `providerMode` on `auto`, and retry after the
provider recovers. The deterministic checks and manifest validation do not require network access.

## Persisted query errors

**Symptom:** `PERSISTED_QUERY_NOT_FOUND`, `AA_CRYPTO_MISSING`, or `NO_EPISODE_DATA`.

**Cause:** AllAnime rotated a persisted hash or is blocking the request.

**Fix:** refresh `HASHES.server`/`HASHES.mainPage` from the current AllAnime web bundle, then run
`npm run test:unit` and `skystream validate`. The stream resolver also attempts a raw GraphQL query
when the server reports a persisted-query error.

## Jikan 429 responses

Jikan is rate-limited per IP. Miruro caches catalog/detail data and only uses Jikan as a fallback
in automatic mode. Wait for the limit window, reduce repeated test calls, or use Kitsu/AllAnime as
the preferred provider. Jikan cannot provide streams directly.

## `INVALID_EPISODE_URL` or `MISSING_EPISODE_ID`

New episode URLs are source-aware JSON:

```json
{"v":2,"source":"allanime","id":"<show-id>","episode":"1","dubStatus":"sub"}
```

Legacy `{\"hash\":\"<show-id>\",\"episode\":\"1\",\"dubStatus\":\"sub\"}` payloads remain supported.
Do not pass a title, poster URL, or an entire `Episode` object as the query string.

## No playable streams

**Symptom:** `NO_PLAYABLE_STREAMS` after source resolution.

**Cause:** the upstream returned embed pages without a direct media URL, a host extractor changed,
or every source is unavailable. Miruro intentionally does not return iframe URLs as playable media.

**Debug steps:**

1. Check the logs for `resolve`, `runtimeExtractor`, or `extractor:<name>` entries.
2. Confirm the source host is supported by the runtime or bundled `skystream-extractors` registry.
3. Verify that the result contains `.m3u8`, `.mpd`, `.mp4`, or another accepted media URL.
4. Retry after the one-minute negative cache expires.

## Plugin not appearing

1. Check `repo.json` and its `pluginLists` URL are valid JSON.
2. Confirm `dist/com.miruro.sky` contains `plugin.json` and the bundled plugin.
3. Run `npm install`, `npm run test:unit`, `skystream validate`, and `skystream deploy` locally.
4. Check the GitHub Actions deploy job after pushing to `main`.
