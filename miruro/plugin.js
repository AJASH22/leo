/**
 * Miruro Anime Provider for SkyStream
 * Uses AllAnime GraphQL API for content + streams, AniList for metadata enrichment
 * Multi-provider support with domain switching and automatic fallback
 */
(function() {
    "use strict";

    // ============================================================================
    // CONFIGURATION
    // ============================================================================

    // Use manifest.baseUrl as the primary domain (user-configurable)
    var BASE_URL = (typeof manifest !== "undefined" && manifest && manifest.baseUrl)
        ? manifest.baseUrl.replace(/\/+$/, "")
        : "https://allanime.to";

    // Multiple provider configurations for fallback
    var PROVIDERS = [
        { id: "AllAnime", baseUrl: "https://allanime.to", apiUrl: "https://api.allanime.day/api" },
        { id: "AllManga", baseUrl: "https://allmanga.to", apiUrl: "https://api.allanime.day/api" }
    ];

    // Current provider (set per-instance by app or via preferences)
    var currentProvider = (typeof manifest !== "undefined" && manifest && manifest.providerId)
        ? manifest.providerId
        : "AllAnime";

    function getProviderConfig() {
        for (var i = 0; i < PROVIDERS.length; i++) {
            if (PROVIDERS[i].id.toLowerCase() === String(currentProvider).toLowerCase()) {
                return PROVIDERS[i];
            }
        }
        return PROVIDERS[0];
    }

    var API_URL = getProviderConfig().apiUrl;

    var HEADERS = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
        "Accept": "application/json",
        "app-version": "android_c-247",
        "from-app": "allmanga",
        "platformstr": "android_c",
        "Referer": "https://allmanga.to",
        "Origin": "https://allmanga.to"
    };

    var PLUGIN_VERSION = 5;
    var CATALOG_VERSION = 3;

    // GraphQL Persisted Query Hashes
    var HASHES = {
        main: "e42a4466d984b2c0a2cecae5dd13aa68867f634b16ee0f17b380047d14482406",
        popular: "60f50b84bb545fa25ee7f7c8c0adbf8f5cea40f7b1ef8501cbbff70e38589489",
        detail: "bb263f91e5bdd048c1c978f324613aeccdfe2cbc694a419466a31edb58c0cc0b",
        server: "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec",
        mainPage: "a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c",
        showsMetadata: "9de1b73e302fa5e471990ed8229c9ad330b3f82a92a288743fb67309520a1996"
    };

    // ============================================================================
    // CACHE SYSTEM
    // ============================================================================

    var responseCache = {};
    var CACHE_TTL = {
        metadata: 600000,      // 10 min for anime details
        search: 300000,        // 5 min for search results
        home: 300000,          // 5 min for home
        stream_failed: 60000   // Only 1 min for failed stream attempts
    };
    var MAX_CACHE_ENTRIES = 200;

    function getCached(key, ttl) {
        var entry = responseCache[key];
        if (!entry) return null;
        if (Date.now() - entry.timestamp > ttl) {
            delete responseCache[key];
            return null;
        }
        return entry.data;
    }

    function setCached(key, data) {
        // Prevent unbounded growth
        var keys = Object.keys(responseCache);
        if (keys.length > MAX_CACHE_ENTRIES) {
            // Remove oldest 20%
            keys.sort(function(a, b) { return responseCache[a].timestamp - responseCache[b].timestamp; });
            for (var i = 0; i < Math.floor(keys.length * 0.2); i++) {
                delete responseCache[keys[i]];
            }
        }
        responseCache[key] = { data: data, timestamp: Date.now() };
    }

    function setCachedFailure(key) {
        // Short-lived failure cache
        responseCache[key] = { data: null, timestamp: Date.now(), failed: true };
    }

    function wasRecentlyFailed(key) {
        var entry = responseCache[key];
        if (!entry || !entry.failed) return false;
        return (Date.now() - entry.timestamp) < CACHE_TTL.stream_failed;
    }

    // ============================================================================
    // LOGGING
    // ============================================================================

    function log(context, message) {
        if (typeof console !== "undefined" && console.log) {
            console.log("[Miruro:" + context + "] " + message);
        }
    }

    function logError(context, error) {
        var msg = String(error).substring(0, 200);
        if (typeof console !== "undefined" && console.error) {
            console.error("[Miruro:" + context + "] ERROR: " + msg);
        }
        return msg;
    }

    // ============================================================================
    // GRAPHQL HELPERS
    // ============================================================================

    function encodeQueryParts(variables, hash) {
        return "variables=" + encodeURIComponent(JSON.stringify(variables || {}))
            + "&extensions=" + encodeURIComponent(JSON.stringify({
                persistedQuery: { version: 1, sha256Hash: hash }
            }));
    }

    async function queryGraph(variables, hash, method) {
        method = method || "GET";
        var url = API_URL + "?" + encodeQueryParts(variables, hash);

        var res;
        try {
            if (method === "GET") {
                res = await http_get(url, HEADERS);
            } else {
                res = await http_post(API_URL, HEADERS, JSON.stringify({
                    variables: variables,
                    extensions: { persistedQuery: { version: 1, sha256Hash: hash } }
                }));
            }
        } catch (e) {
            // Try alternate signature
            try {
                if (method === "GET") {
                    res = await http_get(url, JSON.stringify(HEADERS));
                } else {
                    res = await http_post(API_URL, JSON.stringify({
                        variables: variables,
                        extensions: { persistedQuery: { version: 1, sha256Hash: hash } }
                    }), HEADERS);
                }
            } catch (e2) {
                throw e;
            }
        }

        var bodyStr = (res && res.body) || "";
        if (!res || res.status !== 200) {
            throw new Error("HTTP_ERROR_" + (res ? res.status : "NO_RESPONSE"));
        }
        if (bodyStr.trim().startsWith("<")) {
            throw new Error("CLOUDFLARE_BLOCK");
        }

        try {
            return JSON.parse(bodyStr);
        } catch (e) {
            throw new Error("INVALID_JSON_RESPONSE");
        }
    }

    async function safeQueryGraph(variables, hash, method) {
        try {
            return await queryGraph(variables, hash, method);
        } catch (e) {
            logError("queryGraph", e);
            return null;
        }
    }

    // ============================================================================
    // DATA HELPERS
    // ============================================================================

    function hasEpisodes(edge) {
        if (!edge) return false;
        var available = edge.availableEpisodes;
        if (!available) return true;
        return !(
            Number(available.raw || 0) === 0 &&
            Number(available.sub || 0) === 0 &&
            Number(available.dub || 0) === 0
        );
    }

    function preferredTitle(edge) {
        if (!edge) return "Unknown";
        return edge.englishName || edge.name || edge.nativeName || "Unknown";
    }

    function resolvePosterUrl(thumbnail) {
        if (!thumbnail) return getPosterFallback();
        if (thumbnail.startsWith("http")) return thumbnail;
        if (thumbnail.startsWith("//")) return "https:" + thumbnail;
        return "https://wp.youtube-anime.com/aln.youtube-anime.com/" + thumbnail;
    }

    function getPosterFallback() {
        return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='450' viewBox='0 0 300 450'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%23231f20;stop-opacity:1'/%3E%3Cstop offset='100%25' style='stop-color:%234a4748;stop-opacity:1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill='url(%23grad)' width='300' height='450'/%3E%3Ctext x='150' y='225' text-anchor='middle' dy='.3em' fill='%23b3b3b3' font-size='20' font-family='sans-serif' font-weight='bold'%3EAnime%3C/text%3E%3C/svg%3E";
    }

    function getStatusFromText(status) {
        if (!status) return "unknown";
        var s = String(status).toUpperCase();
        if (s.indexOf("FINISHED") !== -1 || s.indexOf("COMPLETED") !== -1) return "completed";
        if (s.indexOf("RELEASING") !== -1 || s.indexOf("ONGOING") !== -1) return "ongoing";
        if (s.indexOf("NOT_YET") !== -1 || s.indexOf("UPCOMING") !== -1) return "upcoming";
        return "unknown";
    }

    function toMultimediaItem(edge) {
        if (!edge || !edge._id) return null;
        var typeStr = (edge.type || "").toLowerCase();
        var itemType = typeStr.indexOf("movie") !== -1 ? "movie" : "anime";

        return new MultimediaItem({
            title: preferredTitle(edge),
            url: edge._id,
            posterUrl: resolvePosterUrl(edge.thumbnail),
            type: itemType,
            year: edge.airedStart && edge.airedStart.year ? edge.airedStart.year : 0,
            description: edge.description ? edge.description.replace(/<[^>]*>/g, "").substring(0, 500) : "",
            status: getStatusFromText(edge.status),
            tags: [],
            headers: HEADERS
        });
    }

    // ============================================================================
    // ANILIST METADATA ENRICHMENT
    // ============================================================================

    var ANILIST_QUERY = `
    query ($search: String, $id: Int, $idMal: Int) {
      Media(search: $search, id: $id, idMal: $idMal, type: ANIME) {
        id idMal
        bannerImage
        coverImage { extraLarge large medium color }
        title { english romaji native userPreferred }
        startDate { year }
        endDate { year }
        genres description(asHtml: false) averageScore meanScore status episodes duration
        format season seasonYear studios(isMain: true) { nodes { name } }
        characters(perPage: 8) {
          edges { node { name { full } image { large } } role }
        }
        recommendations(perPage: 12) {
          edges {
            node {
              mediaRecommendation {
                id idMal title { english romaji userPreferred } coverImage { large } format averageScore
              }
            }
          }
        }
        nextAiringEpisode { episode airingAt }
      }
    }`;

    async function getAniListMedia(opts) {
        opts = opts || {};
        var variables = { type: "ANIME" };
        if (opts.id) variables.id = opts.id;
        else if (opts.idMal) variables.idMal = opts.idMal;
        else if (opts.search) variables.search = opts.search;

        var cacheKey = "anilist:" + JSON.stringify(variables);
        var cached = getCached(cacheKey, CACHE_TTL.metadata);
        if (cached !== null) return cached;

        var payload = JSON.stringify({ query: ANILIST_QUERY, variables: variables });
        var res;
        try {
            res = await http_post("https://graphql.anilist.co", { "Content-Type": "application/json" }, payload);
        } catch (e) {
            res = await http_post("https://graphql.anilist.co", payload, { "Content-Type": "application/json" });
        }

        if (!res || res.status !== 200) {
            setCached(cacheKey, null);
            return null;
        }

        try {
            var data = JSON.parse(res.body || "{}");
            var media = (data.data && data.data.Media) || null;
            setCached(cacheKey, media);
            return media;
        } catch (e) {
            return null;
        }
    }

    async function getAniZipData(malId) {
        if (!malId) return null;
        var cacheKey = "anizip:" + malId;
        var cached = getCached(cacheKey, CACHE_TTL.metadata);
        if (cached !== null) return cached;

        try {
            var res = await http_get("https://api.ani.zip/mappings?mal_id=" + malId);
            if (!res || res.status !== 200) {
                setCached(cacheKey, null);
                return null;
            }
            var data = JSON.parse(res.body);
            setCached(cacheKey, data);
            return data;
        } catch (e) {
            return null;
        }
    }

    // ============================================================================
    // STREAM RESOLUTION PIPELINE
    // ============================================================================

    var QUALITY_REGEX = /(\d{3,4})p/i;
    var RESOLUTION_REGEX = /RESOLUTION=\d+x(\d+)/;

    function qualityFromText(text) {
        if (!text) return null;
        var m = String(text).match(QUALITY_REGEX);
        if (m) return m[1] + "p";
        m = String(text).match(RESOLUTION_REGEX);
        if (m) {
            var h = parseInt(m[1], 10);
            if (h >= 2160) return "2160p";
            if (h >= 1440) return "1440p";
            if (h >= 1080) return "1080p";
            if (h >= 720) return "720p";
            if (h >= 480) return "480p";
            if (h >= 360) return "360p";
        }
        return null;
    }

    async function expandM3u8Streams(m3u8Url, sourceName, referer, subtitles, streamResults) {
        try {
            var m3u8Headers = Object.assign({}, HEADERS);
            if (referer) m3u8Headers["Referer"] = referer;

            var res;
            try {
                res = await http_get(m3u8Url, m3u8Headers);
            } catch (e) {
                res = await http_get(m3u8Url, JSON.stringify(m3u8Headers));
            }

            if (!res || res.status !== 200) {
                // Fall back to single stream
                streamResults.push(new StreamResult({
                    url: m3u8Url,
                    source: sourceName || "HLS",
                    quality: "Auto",
                    headers: m3u8Headers,
                    subtitles: subtitles || []
                }));
                return;
            }

            var body = res.body || "";
            if (!body.includes("#EXTM3U") && !body.includes("#EXT-X-STREAM-INF")) {
                streamResults.push(new StreamResult({
                    url: m3u8Url,
                    source: sourceName || "HLS",
                    quality: "Auto",
                    headers: m3u8Headers,
                    subtitles: subtitles || []
                }));
                return;
            }

            var lines = body.split(/\r?\n/);
            var pushed = 0;
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf("#EXT-X-STREAM-INF") !== -1 && i + 1 < lines.length) {
                    var info = lines[i];
                    var urlLine = lines[i + 1].trim();
                    if (!urlLine || urlLine.startsWith("#")) continue;

                    var streamUrl = urlLine;
                    if (!streamUrl.startsWith("http")) {
                        var baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
                        streamUrl = baseUrl + streamUrl;
                    }

                    var quality = qualityFromText(info) || "Auto";
                    streamResults.push(new StreamResult({
                        url: streamUrl,
                        source: sourceName || "HLS",
                        quality: quality,
                        headers: m3u8Headers,
                        subtitles: subtitles || []
                    }));
                    pushed++;
                }
            }

            if (pushed === 0) {
                streamResults.push(new StreamResult({
                    url: m3u8Url,
                    source: sourceName || "HLS",
                    quality: "Auto",
                    headers: m3u8Headers,
                    subtitles: subtitles || []
                }));
            }
        } catch (e) {
            logError("expandM3u8", e);
        }
    }

    function findMediaUrlsInHtml(html) {
        if (!html) return [];
        var urls = [];
        var patterns = [
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi,
            /file\s*:\s*["']([^"']+)["']/gi,
            /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/gi
        ];
        for (var i = 0; i < patterns.length; i++) {
            var matches = html.match(patterns[i]);
            if (matches) {
                for (var j = 0; j < matches.length; j++) {
                    urls.push(matches[j].replace(/['"]/g, ""));
                }
            }
        }
        return urls;
    }

    async function resolveVidStackLike(url, sourceName, subtitles, streamResults) {
        try {
            // AES-CBC decrypt for VidStack-like endpoints
            var res = await http_get(url, HEADERS);
            if (!res || res.status !== 200) return false;
            var html = res.body || "";

            // Look for encrypted blob
            var blobMatch = html.match(/--([A-Za-z0-9+/=]+)/);
            if (blobMatch) {
                try {
                    var encrypted = blobMatch[1];
                    var key = "kiemtienmua911ca";
                    var decrypted = await crypto.decryptAES(encrypted, key, "");
                    if (decrypted && decrypted.indexOf("http") !== -1) {
                        await expandM3u8Streams(decrypted, sourceName, url, subtitles, streamResults);
                        return true;
                    }
                } catch (e) {
                    // Fall through
                }
            }

            // Find direct media URLs
            var mediaUrls = findMediaUrlsInHtml(html);
            if (mediaUrls.length > 0) {
                await expandM3u8Streams(mediaUrls[0], sourceName, url, subtitles, streamResults);
                return true;
            }
            return false;
        } catch (e) {
            logError("resolveVidStack", e);
            return false;
        }
    }

    async function resolveStreamWishLike(url, sourceName, subtitles, streamResults) {
        try {
            var res = await http_get(url, HEADERS);
            if (!res || res.status !== 200) return false;
            var html = res.body || "";

            // StreamWish uses jwplayer
            var sourcesMatch = html.match(/sources\s*:\s*\[([^\]]+)\]/);
            if (sourcesMatch) {
                var fileMatch = sourcesMatch[1].match(/file\s*:\s*["']([^"']+)["']/);
                if (fileMatch) {
                    await expandM3u8Streams(fileMatch[1], sourceName, url, subtitles, streamResults);
                    return true;
                }
            }

            var mediaUrls = findMediaUrlsInHtml(html);
            if (mediaUrls.length > 0) {
                await expandM3u8Streams(mediaUrls[0], sourceName, url, subtitles, streamResults);
                return true;
            }
            return false;
        } catch (e) {
            logError("resolveStreamWish", e);
            return false;
        }
    }

    async function resolveFilemoonLike(url, sourceName, subtitles, streamResults) {
        try {
            var res = await http_get(url, HEADERS);
            if (!res || res.status !== 200) return false;
            var html = res.body || "";

            // Filemoon packs with eval; try to find jwplayer data
            var unpacked = (typeof getAndUnpack === "function") ? getAndUnpack(html) : html;
            var mediaUrls = findMediaUrlsInHtml(unpacked);

            if (mediaUrls.length === 0) {
                // Try src= pattern
                var srcMatch = unpacked.match(/src\s*[:=]\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i);
                if (srcMatch) mediaUrls.push(srcMatch[1]);
            }

            if (mediaUrls.length > 0) {
                await expandM3u8Streams(mediaUrls[0], sourceName, url, subtitles, streamResults);
                return true;
            }
            return false;
        } catch (e) {
            logError("resolveFilemoon", e);
            return false;
        }
    }

    async function resolveDirectEmbed(url, sourceName, subtitles, streamResults) {
        try {
            var res = await http_get(url, HEADERS);
            if (!res || res.status !== 200) return false;
            var html = res.body || "";
            var mediaUrls = findMediaUrlsInHtml(html);
            if (mediaUrls.length > 0) {
                var quality = qualityFromText(sourceName) || "Auto";
                streamResults.push(new StreamResult({
                    url: mediaUrls[0],
                    source: sourceName,
                    quality: quality,
                    headers: HEADERS,
                    subtitles: subtitles || []
                }));
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    async function resolveEmbeddedSource(url, sourceName, subtitles, streamResults) {
        if (!url) return false;
        var lowerUrl = url.toLowerCase();

        // Route by hostname
        if (/allanime\.uns\.bio|server1\.uns\.bio/.test(lowerUrl)) {
            return await resolveVidStackLike(url, sourceName, subtitles, streamResults);
        }
        if (/bysekoze\.com|byse\.sx/.test(lowerUrl)) {
            return await resolveVidStackLike(url, sourceName, subtitles, streamResults);
        }
        if (/mwish|dwish|swish|streamwish/.test(lowerUrl)) {
            return await resolveStreamWishLike(url, sourceName, subtitles, streamResults);
        }
        if (/filemoon/.test(lowerUrl)) {
            return await resolveFilemoonLike(url, sourceName, subtitles, streamResults);
        }
        if (/vidstreaming|mp4upload|ok\.ru|streamsb/.test(lowerUrl)) {
            return await resolveDirectEmbed(url, sourceName, subtitles, streamResults);
        }

        // Try built-in extractor for common hosts
        if (typeof globalThis.loadExtractor === "function") {
            try {
                var beforeCount = streamResults.length;
                var resolved = false;
                globalThis.loadExtractor(url, function(results) {
                    if (results && results.length) {
                        for (var i = 0; i < results.length; i++) {
                            var r = results[i];
                            if (r && r.url) {
                                streamResults.push(new StreamResult({
                                    url: r.url,
                                    source: sourceName + " - " + (r.source || "Auto"),
                                    quality: r.quality || qualityFromText(r.url) || "Auto",
                                    headers: r.headers || HEADERS
                                }));
                            }
                        }
                        resolved = true;
                    }
                });
                return resolved || (streamResults.length > beforeCount);
            } catch (e) {
                return false;
            }
        }

        // Last resort: try direct embed probe
        return await resolveDirectEmbed(url, sourceName, subtitles, streamResults);
    }

    async function resolveSourceEntries(sourceData, subtitles) {
        var streamResults = [];
        if (!sourceData) return streamResults;

        var links = [];
        // Handle object form: {link: {href, sourceName}, ...}
        if (typeof sourceData === "object" && !Array.isArray(sourceData)) {
            for (var key in sourceData) {
                if (sourceData.hasOwnProperty(key) && sourceData[key]) {
                    var entry = sourceData[key];
                    if (typeof entry === "string") {
                        links.push({ url: entry, sourceName: key });
                    } else if (entry && entry.link) {
                        links.push({
                            url: entry.link,
                            sourceName: entry.sourceName || entry.name || key,
                            priority: entry.priority
                        });
                    } else if (entry && entry.url) {
                        links.push({
                            url: entry.url,
                            sourceName: entry.sourceName || entry.name || key
                        });
                    }
                }
            }
        } else if (Array.isArray(sourceData)) {
            for (var i = 0; i < sourceData.length; i++) {
                var item = sourceData[i];
                if (typeof item === "string") {
                    links.push({ url: item, sourceName: "Stream " + (i + 1) });
                } else if (item) {
                    // AllAnime returns {sourceUrl, sourceName, priority, type, ...}
                    var rawUrl = item.sourceUrl || item.link || item.url;
                    if (rawUrl) {
                        links.push({
                            url: rawUrl,
                            sourceName: item.sourceName || item.source || "Stream " + (i + 1),
                            priority: item.priority,
                            type: item.type,
                            subtitles: item.subtitles,
                            downloads: item.downloads,
                            resolutionStr: item.resolutionStr,
                            hls: item.hls
                        });
                    }
                }
            }
        }

        log("resolve", "Found " + links.length + " source links");

        for (var j = 0; j < links.length; j++) {
            var link = links[j];
            if (!link.url) continue;

            // Skip if recently failed
            var failKey = "streamfail:" + link.url;
            if (wasRecentlyFailed(failKey)) continue;

            try {
                // Handle relative links (AllAnime-specific JSON endpoint)
                if (link.url.startsWith("/")) {
                    var absUrl = "https://allanime.day" + link.url.replace(/\.json.*$/, "") + ".json?";
                    try {
                        var jsonRes = await http_get(absUrl, HEADERS);
                        if (jsonRes && jsonRes.status === 200) {
                            var jsonData = JSON.parse(jsonRes.body);
                            if (jsonData.links && Array.isArray(jsonData.links)) {
                                for (var k = 0; k < jsonData.links.length; k++) {
                                    var subLink = jsonData.links[k];
                                    if (subLink && (subLink.link || subLink.url)) {
                                        var resolved = await resolveEmbeddedSource(
                                            subLink.link || subLink.url,
                                            link.sourceName + " - " + (subLink.resolution || subLink.quality || "Auto"),
                                            subtitles,
                                            streamResults
                                        );
                                        if (!resolved) setCachedFailure(failKey);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        logError("relativeLink", e);
                    }
                } else {
                    var beforeCount = streamResults.length;
                    var resolved = await resolveEmbeddedSource(link.url, link.sourceName, subtitles, streamResults);
                    if (!resolved) {
                        // If extraction failed but URL is a valid iframe embed, still include it
                        // SkyStream can play iframe embeds directly
                        if (/^https?:\/\//i.test(link.url)) {
                            var quality = qualityFromText(link.url) || qualityFromText(link.sourceName) || "Auto";
                            streamResults.push(new StreamResult({
                                url: link.url,
                                source: "AllAnime - " + (link.sourceName || "Embed"),
                                quality: quality,
                                headers: HEADERS
                            }));
                            resolved = true;
                            log("resolve", "Added direct embed for: " + link.url.substring(0, 60));
                        } else {
                            setCachedFailure(failKey);
                        }
                    }
                }
            } catch (e) {
                logError("sourceEntry", e);
            }
        }

        // Deduplicate by url|quality
        var seen = {};
        var deduped = [];
        for (var m = 0; m < streamResults.length; m++) {
            var s = streamResults[m];
            if (!s || !s.url) continue;
            var key = s.url + "|" + s.quality;
            if (seen[key]) continue;
            seen[key] = true;
            deduped.push(s);
        }

        log("resolve", "Returning " + deduped.length + " unique streams");
        return deduped;
    }

    // ============================================================================
    // CORE PLUGIN FUNCTIONS
    // ============================================================================

    async function getHome(cb) {
        try {
            log("home", "Fetching home sections");
            var now = new Date();
            var month = now.getMonth() + 1;
            var year = now.getFullYear();
            var season = month <= 3 ? "Winter" : month <= 6 ? "Spring" : month <= 9 ? "Summer" : "Fall";

            var categories = {
                "Trending": { search: { season: season, year: year }, translationType: "sub", countryOrigin: "ALL" },
                "Popular": { search: {}, translationType: "sub", countryOrigin: "ALL" },
                "Latest": { search: {}, translationType: "sub", countryOrigin: "ALL" },
                "Movies": { search: { types: ["Movie"] }, translationType: "sub", countryOrigin: "ALL" }
            };

            var homeData = {};
            var categoryEntries = Object.entries(categories);

            // Fetch all categories in parallel
            var sectionResults = await Promise.allSettled(categoryEntries.map(async function(entry) {
                var name = entry[0];
                var variables = entry[1];
                var res = await queryGraph({ ...variables, limit: 26, page: 1 }, HASHES.mainPage, "GET");
                var items = (res && res.data && res.data.shows && res.data.shows.edges || [])
                    .filter(hasEpisodes)
                    .map(toMultimediaItem)
                    .filter(Boolean);
                return { name: name, items: items };
            }));

            sectionResults.forEach(function(result) {
                if (result.status !== "fulfilled") return;
                if (!result.value.items || result.value.items.length === 0) return;
                homeData[result.value.name] = result.value.items;
            });

            // Also try popular recommendations
            try {
                var popularRes = await safeQueryGraph(
                    { type: "anime", size: 30, dateRange: 1, page: 1, allowAdult: false, allowUnknown: false },
                    HASHES.popular,
                    "GET"
                );
                if (popularRes && popularRes.data && popularRes.data.queryPopular) {
                    var popularItems = (popularRes.data.queryPopular.recommendations || [])
                        .map(function(r) { return toMultimediaItem(r.anyCard); })
                        .filter(Boolean)
                        .filter(hasEpisodes);
                    if (popularItems.length > 0 && !homeData["Popular"]) {
                        homeData["Popular"] = popularItems;
                    }
                }
            } catch (e) {
                logError("popular", e);
            }

            if (Object.keys(homeData).length === 0) {
                log("home", "No sections available");
                return cb({
                    success: false,
                    errorCode: "HOME_ERROR",
                    message: "No home sections available from provider"
                });
            }

            log("home", "Returning " + Object.keys(homeData).length + " sections");
            cb({ success: true, data: homeData });
        } catch (e) {
            logError("home", e);
            cb({
                success: false,
                errorCode: "HOME_ERROR",
                message: e.message || "Failed to load home"
            });
        }
    }

    async function search(query, cb) {
        try {
            if (!query || query.trim().length === 0) {
                return cb({ success: true, data: [] });
            }

            log("search", 'Query: "' + query + '"');
            var cacheKey = "search:" + query.toLowerCase();
            var cached = getCached(cacheKey, CACHE_TTL.search);
            if (cached) {
                log("search", "Cache hit: " + cached.length + " results");
                return cb({ success: true, data: cached });
            }

            var variables = {
                search: { query: query },
                limit: 30,
                page: 1,
                translationType: "sub",
                countryOrigin: "ALL"
            };

            var res = await queryGraph(variables, HASHES.mainPage, "GET");
            var items = (res && res.data && res.data.shows && res.data.shows.edges || [])
                .filter(hasEpisodes)
                .map(toMultimediaItem)
                .filter(Boolean);

            log("search", "Found " + items.length + " results");
            setCached(cacheKey, items);
            cb({ success: true, data: items });
        } catch (e) {
            logError("search", e);
            cb({
                success: false,
                errorCode: "SEARCH_ERROR",
                message: e.message || "Search failed"
            });
        }
    }

    async function load(url, cb) {
        try {
            log("load", "Loading: " + url);
            var cacheKey = "detail:" + url;
            var cached = getCached(cacheKey, CACHE_TTL.metadata);
            if (cached) {
                log("load", "Cache hit");
                return cb({ success: true, data: cached });
            }

            var res = await queryGraph({ _id: url }, HASHES.detail, "GET");
            var show = res && res.data && res.data.show;

            if (!show) {
                return cb({
                    success: false,
                    errorCode: "DETAILS_FAILED",
                    message: "Show not found"
                });
            }

            var title = show.name || show.englishName || show.nativeName || "Unknown";
            var year = show.airedStart && show.airedStart.year ? show.airedStart.year : null;
            var season = show.season && show.season.quarter;
            var showType = show.type;

            // Enrich with AniList metadata in parallel
            var aniMedia = null;
            if (show.idMal) {
                aniMedia = await getAniListMedia({ idMal: show.idMal });
            }
            if (!aniMedia) {
                aniMedia = await getAniListMedia({ search: title });
            }

            var aniZip = show.idMal ? await getAniZipData(show.idMal) : null;

            // Determine title and metadata
            var resolvedTitle = (aniZip && aniZip.titles && aniZip.titles.en) ||
                                show.englishName ||
                                (aniMedia && aniMedia.title && aniMedia.title.english) ||
                                title;
            var poster = (aniMedia && aniMedia.coverImage && (aniMedia.coverImage.extraLarge || aniMedia.coverImage.large)) ||
                         resolvePosterUrl(show.thumbnail);
            var banner = (aniMedia && aniMedia.bannerImage) || poster;
            var description = (aniMedia && aniMedia.description) || (show.description ? show.description.replace(/<[^>]*>/g, "") : "");
            var genres = (aniMedia && aniMedia.genres) || [];
            var averageScore = (aniMedia && aniMedia.averageScore) || 0;
            var status = getStatusFromText((aniMedia && aniMedia.status) || show.status);
            var totalEpisodes = (aniMedia && aniMedia.episodes) || 0;

            // Build episode lists (sub and dub)
            var subEpisodes = (show.availableEpisodesDetail && show.availableEpisodesDetail.sub) || [];
            var dubEpisodes = (show.availableEpisodesDetail && show.availableEpisodesDetail.dub) || [];

            var allEpisodes = [];

            // Add sub episodes
            for (var i = 0; i < subEpisodes.length; i++) {
                var epNum = subEpisodes[i];
                var aniEp = (aniZip && aniZip.episodes) ? aniZip.episodes[epNum] : null;
                allEpisodes.push(new Episode({
                    name: (aniEp && aniEp.title && (aniEp.title.en || aniEp.title.ja)) || "Episode " + epNum,
                    url: JSON.stringify({
                        hash: show._id,
                        dubStatus: "sub",
                        episode: epNum,
                        idMal: show.idMal
                    }),
                    season: 1,
                    episode: parseInt(epNum, 10),
                    description: (aniEp && aniEp.overview) || "",
                    posterUrl: (aniEp && aniEp.image) || poster,
                    runtime: (aniEp && aniEp.runtime) || 24,
                    airDate: (aniEp && aniEp.airDate) || null,
                    dubStatus: "subbed",
                    headers: HEADERS
                }));
            }

            // Add dub episodes (marked differently)
            for (var j = 0; j < dubEpisodes.length; j++) {
                var dubEpNum = dubEpisodes[j];
                var dubAniEp = (aniZip && aniZip.episodes) ? aniZip.episodes[dubEpNum] : null;
                allEpisodes.push(new Episode({
                    name: (dubAniEp && dubAniEp.title && (dubAniEp.title.en || dubAniEp.title.ja)) || "Episode " + dubEpNum + " (Dub)",
                    url: JSON.stringify({
                        hash: show._id,
                        dubStatus: "dub",
                        episode: dubEpNum,
                        idMal: show.idMal
                    }),
                    season: 1,
                    episode: parseInt(dubEpNum, 10),
                    description: (dubAniEp && dubAniEp.overview) || "",
                    posterUrl: (dubAniEp && dubAniEp.image) || poster,
                    runtime: (dubAniEp && dubAniEp.runtime) || 24,
                    airDate: (dubAniEp && dubAniEp.airDate) || null,
                    dubStatus: "dubbed",
                    headers: HEADERS
                }));
            }

            // Build recommendations
            var recommendations = [];
            if (aniMedia && aniMedia.recommendations && aniMedia.recommendations.edges) {
                for (var k = 0; k < aniMedia.recommendations.edges.length; k++) {
                    var rec = aniMedia.recommendations.edges[k].node;
                    if (rec && rec.mediaRecommendation) {
                        var mr = rec.mediaRecommendation;
                        recommendations.push(new MultimediaItem({
                            title: (mr.title && (mr.title.english || mr.title.romaji || mr.title.userPreferred)) || "Unknown",
                            url: mr.id ? String(mr.id) : "",
                            posterUrl: (mr.coverImage && mr.coverImage.large) || getPosterFallback(),
                            type: "anime",
                            score: mr.averageScore ? mr.averageScore / 10 : 0,
                            headers: HEADERS
                        }));
                    }
                }
            }

            // Build cast
            var cast = [];
            if (aniMedia && aniMedia.characters && aniMedia.characters.edges) {
                for (var l = 0; l < aniMedia.characters.edges.length; l++) {
                    var char = aniMedia.characters.edges[l].node;
                    if (char) {
                        cast.push({
                            name: (char.name && char.name.full) || "Unknown",
                            role: aniMedia.characters.edges[l].role || "",
                            image: (char.image && char.image.large) || ""
                        });
                    }
                }
            }

            var item = new MultimediaItem({
                title: resolvedTitle,
                url: url,
                posterUrl: poster,
                type: (showType && showType.toLowerCase().indexOf("movie") !== -1) ? "movie" : "anime",
                bannerUrl: banner,
                description: description ? description.substring(0, 1000) : "",
                year: year || (aniMedia && aniMedia.startDate && aniMedia.startDate.year) || 0,
                score: averageScore ? averageScore / 10 : 0,
                duration: (aniMedia && aniMedia.duration) || 24,
                status: status,
                tags: genres,
                cast: cast,
                recommendations: recommendations,
                episodes: allEpisodes,
                headers: HEADERS
            });

            setCached(cacheKey, item);
            log("load", "Loaded: " + resolvedTitle + " with " + allEpisodes.length + " episodes");
            cb({ success: true, data: item });
        } catch (e) {
            logError("load", e);
            cb({
                success: false,
                errorCode: "DETAILS_FAILED",
                message: e.message || "Failed to load details"
            });
        }
    }

    async function loadStreams(url, cb) {
        try {
            log("streams", "Resolving streams for: " + url.substring(0, 80));

            // Parse the episode URL (JSON-encoded payload)
            var payload;
            try {
                payload = JSON.parse(url);
            } catch (e) {
                return cb({
                    success: false,
                    errorCode: "SOURCE_RESOLUTION_FAILED",
                    message: "Invalid episode URL"
                });
            }

            if (!payload || !payload.hash) {
                return cb({
                    success: false,
                    errorCode: "SOURCE_RESOLUTION_FAILED",
                    message: "Missing episode hash"
                });
            }

            var episode = String(payload.episode);
            var dubStatus = payload.dubStatus || "sub";
            var showId = payload.hash;

            // Cache key
            var cacheKey = "streams:" + showId + ":" + dubStatus + ":" + episode;
            if (wasRecentlyFailed(cacheKey)) {
                return cb({
                    success: false,
                    errorCode: "SOURCE_RESOLUTION_FAILED",
                    message: "Recently failed, retry shortly"
                });
            }

            // Fetch the source URLs from AllAnime
            // AllAnime server endpoint expects: showId, translationType, episodeString (NOT episode)
            var variables = {
                showId: showId,
                episodeString: episode,
                translationType: dubStatus
            };

            log("streams", "Querying server endpoint with showId=" + showId + " episode=" + episode + " dub=" + dubStatus);

            // Try multiple attempts: GET, POST, with different hashes
            var res = null;
            var attempts = [
                { method: "GET", hash: HASHES.server },
                { method: "POST", hash: HASHES.server },
                { method: "GET", hash: HASHES.server }  // retry in case of transient
            ];

            for (var attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
                try {
                    res = await queryGraph(variables, attempts[attemptIdx].hash, attempts[attemptIdx].method);
                    if (res && res.data && res.data.episode) {
                        break;
                    }
                    // If PERSISTED_QUERY_NOT_FOUND, no point retrying
                    if (res && res.errors) {
                        var errCode = res.errors[0] && res.errors[0].extensions && res.errors[0].extensions.code;
                        if (errCode === "PERSISTED_QUERY_NOT_FOUND" || errCode === "AA_CRYPTO_MISSING") {
                            log("streams", "API error " + errCode + " - trying alternate...");
                            // Try direct query text (no persisted hash)
                            try {
                                var directQuery = "query($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) { episode(showId: $showId, translationType: $translationType, episodeString: $episodeString) { episodeString sourceUrls subtitles } }";
                                var directBody = JSON.stringify({
                                    query: directQuery,
                                    variables: variables
                                });
                                var directRes = await http_post(API_URL, HEADERS, directBody);
                                if (directRes && directRes.body) {
                                    try {
                                        var parsedRes = JSON.parse(directRes.body);
                                        if (parsedRes && parsedRes.data && parsedRes.data.episode) {
                                            log("streams", "Direct query succeeded");
                                            res = parsedRes;
                                            break;
                                        }
                                        if (parsedRes && parsedRes.errors) {
                                            log("streams", "Direct query error: " + (parsedRes.errors[0] && parsedRes.errors[0].message));
                                        }
                                    } catch (parseErr) {
                                        log("streams", "Failed to parse direct query response");
                                    }
                                }
                            } catch (altErr) {
                                log("streams", "Direct query attempt failed: " + altErr.message);
                            }
                        }
                    }
                } catch (e) {
                    log("streams", "Attempt " + (attemptIdx + 1) + " failed: " + e.message);
                }
            }

            if (!res || !res.data || !res.data.episode) {
                if (res && res.errors) {
                    logError("streams:graphql", JSON.stringify(res.errors).substring(0, 300));
                }
                setCachedFailure(cacheKey);
                return cb({
                    success: false,
                    errorCode: "SOURCE_RESOLUTION_FAILED",
                    message: "No episode data returned"
                });
            }

            var episodeData = res.data.episode;
            var sourceUrls = episodeData.sourceUrls;

            if (!sourceUrls || (typeof sourceUrls !== "object")) {
                setCachedFailure(cacheKey);
                return cb({
                    success: false,
                    errorCode: "SOURCE_RESOLUTION_FAILED",
                    message: "No source URLs available"
                });
            }

            log("streams", "Found source URLs, resolving...");

            // Extract subtitles if available
            var subtitles = [];
            if (episodeData.subtitles && Array.isArray(episodeData.subtitles)) {
                for (var i = 0; i < episodeData.subtitles.length; i++) {
                    var sub = episodeData.subtitles[i];
                    if (sub && sub.url) {
                        subtitles.push({
                            url: sub.url,
                            label: sub.lang || sub.label || "Subtitle",
                            lang: sub.lang || "en"
                        });
                    }
                }
            }

            // Resolve all source entries
            var streamResults = await resolveSourceEntries(sourceUrls, subtitles);

            if (streamResults.length === 0) {
                setCachedFailure(cacheKey);
                return cb({
                    success: false,
                    errorCode: "SOURCE_VALIDATION_FAILED",
                    message: "No playable streams found after resolution"
                });
            }

            // Cache successful result briefly
            setCached(cacheKey, streamResults);

            log("streams", "Returning " + streamResults.length + " streams");
            cb({ success: true, data: streamResults });
        } catch (e) {
            logError("streams", e);
            setCachedFailure("streams:" + url);
            cb({
                success: false,
                errorCode: "SOURCE_RESOLUTION_FAILED",
                message: e.message || "Stream resolution failed"
            });
        }
    }

    // ============================================================================
    // EXPORT
    // ============================================================================

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
