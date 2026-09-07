# Troubleshooting

Common failure modes and how to debug them.

## "Cloudflare block" / empty results from AllAnime

**Symptom:** `log: queryGraph CLOUDFLARE_BLOCK` in console, `getHome` returns no categories.

**Cause:** AllAnime is serving a Cloudflare JS challenge (HTTP 403 + HTML body that starts
with `<`).

**Fix / mitigation:**
- The plugin falls back to Jikan automatically for catalog/search.
- Streams *cannot* fall back to Jikan — they are only on AllAnime. If you need streams, the
  user must wait for AllAnime to unblock their IP, or switch to a different AllAnime mirror
  (update `BASE_URL` in the manifest's `baseUrl`).
- If you're running this in a region with consistent blocks, deploy from a server in a
  different region and use it as a proxy.

## "PERSISTED_QUERY_NOT_FOUND" from AllAnime

**Symptom:** `log: streams PERSISTED_QUERY_NOT_FOUND` and `loadStreams` returns failure.

**Cause:** AllAnime rotated the persisted-query hash. `HASHES.server` no longer matches the
current server-side bundle.

**Fix:**
1. Open `https://allanime.to` in a browser, view source, and grab the current
   `static/chunks/pages/_app-*.js`.
2. `grep -E 'sha256Hash|"[a-f0-9]{64}"' _app-*.js` to find the new hashes.
3. Update `HASHES` in `miruro/plugin.js` and re-deploy.

## Jikan 429 (Too Many Requests)

**Symptom:** `load: jikan 429`, search results empty for users hitting the same IP.

**Cause:** Jikan's burst limit (2 req/s, 60 req/min) is shared across all users on the
client IP. The plugin only hits Jikan when AllAnime fails, so the load should normally be
low — but if a lot of users are on the same NAT, the limit can be reached.

**Fix:** The plugin retries nothing automatically; users see no results for ~60 s and then
Jikan recovers. If this is persistent in production, add a per-process Jikan rate limiter.

## M3U8 extraction returns no streams

**Symptom:** `log: resolveEmbeddedSource false`, then the direct-embed fallback adds the raw
iframe URL as a `StreamResult`.

**Cause:** The host (Filemoon, StreamWish, etc.) changed its layout or added a new packed
format that the current resolver doesn't recognize.

**Fix:** Inspect the host manually with `curl -I` and the dev tools, then update the
matching resolver in `miruro/plugin.js`. The extractor pipeline is designed to be
extensible — add a new branch in `resolveEmbeddedSource`'s host-pattern table.

## "No episode data returned" from `loadStreams`

**Symptom:** `loadStreams` returns `{ success: false, errorCode: "SOURCE_RESOLUTION_FAILED" }`.

**Cause:** Either:
- The `hash` field in the episode URL is wrong (corrupt cache, modified client).
- AllAnime's `server` endpoint is blocking the IP.
- The episode number is out of range for this show.

**Fix:** Re-run with a known-good payload:
```bash
skystream test -p miruro -f loadStreams -q '{"hash":"<known-id>","episode":"1","dubStatus":"sub"}'
```

## Plugin not appearing in SkyStream

**Symptom:** After adding the repo URL, no plugins show up.

**Fix checklist:**
1. Open `https://raw.githubusercontent.com/AJASH22/leo/main/repo.json` in a browser — it
   should be valid JSON.
2. Follow the `pluginLists` URL inside it — it should be a valid JSON array of plugin
   manifests, each with a `url` pointing to a `.sky` zip under `dist/`.
3. Open one `.sky` URL — it should be a valid ZIP containing `plugin.json` + `plugin.js`.
4. Check the GitHub Actions tab — the deploy workflow should have run on the most recent
   commit to `main`.
