/**
 * Miruro Anime Provider for SkyStream
 *
 * Catalog:  AllAnime GraphQL → Jikan → Kitsu → optional self-hosted HiAnime API
 * Streams:  provider adapters → bundled SkyStream extractors → validated media URLs
 * Meta:     AniList GraphQL + Jikan + AniZip (when MAL id is available)
 *
 * Plugin contract (per skystream-cli):
 *   async function getHome(cb)
 *   async function search(query, cb)
 *   async function load(url, cb)
 *   async function loadStreams(url, cb)
 *
 * The internal `_getHome` / `_search` / `_load` / `_loadStreams` are modern async functions
 * that return data directly. The exported adapters forward to them and shape the result
 * into the `{ success, data } | { success: false, errorCode, message }` envelope the host
 * and `skystream test` expect.
 */
(function () {
    "use strict";

    // ============================================================================
    // CONFIG
    // ============================================================================

    var BASE_URL = (typeof manifest !== "undefined" && manifest && manifest.baseUrl)
        ? String(manifest.baseUrl).replace(/\/+$/, "")
        : "https://allanime.to";

    // Anime-only provider profiles. HiAnime is intentionally configurable because its API
    // is designed for personal/self-hosted deployments, not a permanent public endpoint.
    var PROVIDERS = [
        { id: "AllAnime", baseUrl: "https://allanime.to", apiUrl: "https://api.allanime.day/api", kind: "allanime" },
        { id: "Jikan", baseUrl: "https://api.jikan.moe/v4", apiUrl: "https://api.jikan.moe/v4", kind: "jikan" },
        { id: "Kitsu", baseUrl: "https://kitsu.io", apiUrl: "https://kitsu.io/api/edge", kind: "kitsu" },
        { id: "HiAnime", baseUrl: "", apiUrl: "", kind: "hianime" }
    ];

    function getPreferenceValue(key, fallback) {
        try {
            if (typeof getPreference === "function") {
                var value = getPreference(key);
                if (value !== null && value !== undefined && String(value).length > 0) return String(value);
            }
        } catch (e) { /* preference API unavailable */ }
        return fallback;
    }

    function getHiAnimeBaseUrl() {
        return getPreferenceValue("hiAnimeBaseUrl", "").replace(/\/+$/, "");
    }

    // Resolve the active provider from a preference, while auto mode keeps fallback enabled.
    function getProviderMode() {
        return getPreferenceValue("providerMode", "auto").toLowerCase();
    }

    function getProviderConfig(id) {
        var target = id || getPreferenceValue("providerId", "AllAnime");
        for (var i = 0; i < PROVIDERS.length; i++) {
            if (PROVIDERS[i].id.toLowerCase() === String(target).toLowerCase()) return PROVIDERS[i];
        }
        return PROVIDERS[0];
    }

    function getApiUrl() {
        return (typeof manifest !== "undefined" && manifest && manifest.apiUrl)
            ? String(manifest.apiUrl).replace(/\/+$/, "")
            : getProviderConfig("AllAnime").apiUrl;
    }

    var HEADERS = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
        "Accept": "application/json",
        "app-version": "android_c-247",
        "from-app": "allanime",
        "platformstr": "android_c",
        "Referer": "https://allanime.to",
        "Origin": "https://allanime.to"
    };

    // The host may expose these settings in its extension settings UI.
    if (typeof registerSettings === "function") {
        try {
            registerSettings({
                providerMode: {
                    type: "select",
                    label: "Anime source mode",
                    default: "auto",
                    options: [
                        { label: "Automatic failover", value: "auto" },
                        { label: "AllAnime only", value: "allanime" },
                        { label: "Jikan only", value: "jikan" },
                        { label: "Kitsu only", value: "kitsu" },
                        { label: "HiAnime API only", value: "hianime" }
                    ]
                },
                providerId: {
                    type: "select",
                    label: "Preferred anime source",
                    default: "AllAnime",
                    options: [
                        { label: "AllAnime", value: "AllAnime" },
                        { label: "Jikan", value: "Jikan" },
                        { label: "Kitsu", value: "Kitsu" },
                        { label: "HiAnime API", value: "HiAnime" }
                    ]
                },
                hiAnimeBaseUrl: {
                    type: "text",
                    label: "Self-hosted HiAnime API URL",
                    default: ""
                }
            });
        } catch (e) { /* settings API unavailable */ }
    }

    // SkyStream requires an integer manifest version. The public release label is kept
    // separately so repository-facing documentation can use the requested 1.0, 1.1 style.
    var PLUGIN_VERSION = 7;
    var PUBLIC_VERSION = "1.1";
    var CATALOG_VERSION = 5;

    // GraphQL persisted-query hashes. If AllAnime rotates its bundle these must be refreshed.
    // See docs/API.md for how to extract them.
    var HASHES = {
        main:          "e42a4466d984b2c0a2cecae5dd13aa68867f634b16ee0f17b380047d14482406",
        popular:       "60f50b84bb545fa25ee7f7c8c0adbf8f5cea40f7b1ef8501cbbff70e38589489",
        detail:        "bb263f91e5bdd048c1c978f324613aeccdfe2cbc694a419466a31edb58c0cc0b",
        server:        "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec",
        mainPage:      "a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c",
        showsMetadata: "9de1b73e302fa5e471990ed8229c9ad330b3f82a92a288743fb67309520a1996"
    };

    // ============================================================================
    // CACHE
    // ============================================================================

    var responseCache = {};
    var inFlightRequests = {};
    var CACHE_TTL = {
        metadata:       600000,   // 10 min
        search:         300000,   // 5 min
        home:           300000,   // 5 min
        stream_failed:   60000    // 1 min negative cache
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
        var keys = Object.keys(responseCache);
        if (keys.length > MAX_CACHE_ENTRIES) {
            keys.sort(function (a, b) { return responseCache[a].timestamp - responseCache[b].timestamp; });
            for (var i = 0; i < Math.floor(keys.length * 0.2); i++) {
                delete responseCache[keys[i]];
            }
        }
        responseCache[key] = { data: data, timestamp: Date.now() };
    }

    function setCachedFailure(key) {
        responseCache[key] = { data: null, timestamp: Date.now(), failed: true };
    }

    function withRequestCoalescing(key, factory) {
        if (inFlightRequests[key]) return inFlightRequests[key];
        var request;
        try {
            request = Promise.resolve().then(factory);
        } catch (e) {
            request = Promise.reject(e);
        }
        inFlightRequests[key] = request;
        request.then(function () { delete inFlightRequests[key]; }, function () { delete inFlightRequests[key]; });
        return request;
    }

    function withTimeout(promise, timeoutMs, label) {
        var timer;
        var timeout = new Promise(function (_, reject) {
            timer = setTimeout(function () { reject(new Error((label || "REQUEST") + "_TIMEOUT")); }, timeoutMs);
        });
        return Promise.race([promise, timeout]).then(function (value) {
            clearTimeout(timer);
            return value;
        }, function (error) {
            clearTimeout(timer);
            throw error;
        });
    }

    function requestWithTimeout(factory, label) {
        return withTimeout(Promise.resolve().then(factory), 15000, label);
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

    function logError(context, err) {
        var msg = String((err && err.message) || err || "").substring(0, 200);
        if (typeof console !== "undefined" && console.error) {
            console.error("[Miruro:" + context + "] ERROR: " + msg);
        }
        return msg;
    }

    // ============================================================================
    // GRAPHQL HELPERS (AllAnime)
    // ============================================================================

    function encodeQueryParts(variables, hash) {
        return "variables=" + encodeURIComponent(JSON.stringify(variables || {}))
            + "&extensions=" + encodeURIComponent(JSON.stringify({
                persistedQuery: { version: 1, sha256Hash: hash }
            }));
    }

    async function queryGraph(variables, hash, method) {
        method = method || "GET";
        var apiUrl = getApiUrl();
        var url = apiUrl + "?" + encodeQueryParts(variables, hash);

        var res;
        try {
            if (method === "GET") {
                res = await requestWithTimeout(function () { return http_get(url, HEADERS); }, "GRAPHQL");
            } else {
                res = await requestWithTimeout(function () { return http_post(apiUrl, HEADERS, JSON.stringify({
                    variables: variables,
                    extensions: { persistedQuery: { version: 1, sha256Hash: hash } }
                })); }, "GRAPHQL");
            }
        } catch (e) {
            // Retry with the alternate SDK signature (some hosts use positional args).
            try {
                if (method === "GET") {
                    res = await requestWithTimeout(function () { return http_get(url, JSON.stringify(HEADERS)); }, "GRAPHQL");
                } else {
                    res = await requestWithTimeout(function () { return http_post(apiUrl, JSON.stringify({
                        variables: variables,
                        extensions: { persistedQuery: { version: 1, sha256Hash: hash } }
                    }), HEADERS); }, "GRAPHQL");
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

    var REJECTED_MEDIA_TYPES = /(^|\\b)(manga|manhwa|manhua|comic|novel|light novel|web novel|doujin)(\\b|$)/i;
    var VIDEO_MEDIA_TYPES = /(^|\\b)(anime|tv|movie|ova|ona|special|music|series|film)(\\b|$)/i;

    function isAnimeType(value) {
        if (!value) return true;
        var text = String(value).toLowerCase().trim();
        if (REJECTED_MEDIA_TYPES.test(text)) return false;
        return VIDEO_MEDIA_TYPES.test(text) || text === "";
    }

    function isAnimeRecord(record) {
        if (!record) return false;
        var type = record.type || record.format || record.kind || record.mediaType;
        if (!isAnimeType(type)) return false;
        if (record.type && REJECTED_MEDIA_TYPES.test(String(record.type))) return false;
        if (record.format && REJECTED_MEDIA_TYPES.test(String(record.format))) return false;
        if (record.chapters || record.volumes || record.chapterCount) return false;
        if (record.isManga === true || record.media_type === "manga") return false;
        return true;
    }

    function sourceId(source, id, extras) {
        var payload = Object.assign({ v: 2, source: source, id: String(id || "") }, extras || {});
        return JSON.stringify(payload);
    }

    function parseSourceId(value) {
        var parsed = value;
        if (!parsed || typeof parsed !== "object") {
            try { parsed = JSON.parse(String(value || "")); }
            catch (e) { parsed = null; }
        }
        if (parsed && typeof parsed === "object") {
            // v1 episode payloads used `hash`; normalize them without breaking old clients.
            if (parsed.hash && !parsed.id) parsed.id = parsed.hash;
            parsed.v = parsed.v || 1;
            parsed.source = parsed.source || "allanime";
            return parsed;
        }
        return { v: 1, source: "allanime", id: String(value || "") };
    }

    function normalizeText(value) {
        return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
    }

    function uniqueStrings(values) {
        var seen = {};
        var result = [];
        (Array.isArray(values) ? values : [values]).forEach(function (value) {
            var text = normalizeText(value);
            var key = text.toLocaleLowerCase();
            if (text && !seen[key]) { seen[key] = true; result.push(text); }
        });
        return result;
    }

    function firstNonEmpty() {
        for (var i = 0; i < arguments.length; i++) {
            if (arguments[i] !== null && arguments[i] !== undefined && String(arguments[i]).trim()) return arguments[i];
        }
        return "";
    }

    function numberOrNull(value) {
        if (value === null || value === undefined || value === "") return null;
        var number = Number(value);
        return isFinite(number) ? number : null;
    }

    function normalizeDate(value) {
        if (!value) return null;
        var text = String(value);
        return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.substring(0, 10) : text;
    }

    function normalizeImageUrl(value, fallback) {
        if (!value) return fallback || getPosterFallback();
        var text = String(value).trim();
        if (!text) return fallback || getPosterFallback();
        if (text.indexOf("//") === 0) return "https:" + text;
        if (/^https?:\/\//i.test(text) || /^data:image\//i.test(text)) return text;
        // AllAnime sometimes returns a thumbnail path without an origin.
        if (text.charAt(0) === "/") return absoluteUrl(text, BASE_URL);
        return "https://wp.youtube-anime.com/aln.youtube-anime.com/" + text.replace(/^\/+/, "");
    }

    function getAnimeMergeKey(record) {
        if (!record) return "";
        var sync = record.syncData || {};
        if (record.idMal || record.mal_id || sync.malId) return "mal:" + String(record.idMal || record.mal_id || sync.malId);
        if (record.anilistId || sync.anilistId) return "anilist:" + String(record.anilistId || sync.anilistId);
        if (record.kitsuId || sync.kitsuId) return "kitsu:" + String(record.kitsuId || sync.kitsuId);
        var title = record.title || record.name || record.englishName || record.title_english || "";
        var year = record.year || (record.airedStart && record.airedStart.year) || "";
        var normalizedTitle = normalizeText(title);
        if (normalizedTitle.normalize) normalizedTitle = normalizedTitle.normalize("NFKD").replace(/[̀-ͯ]/g, "");
        return (normalizedTitle.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-") + ":" + year);
    }

    function absoluteUrl(value, baseUrl) {
        if (!value) return "";
        try { return new URL(String(value), baseUrl || "https://allanime.day").toString(); }
        catch (e) { return String(value); }
    }

    function hasEpisodes(edge) {
        if (!edge) return false;
        var available = edge.availableEpisodes;
        if (!available) return true;
        return !(
            Number(available.raw  || 0) === 0 &&
            Number(available.sub   || 0) === 0 &&
            Number(available.dub   || 0) === 0
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
        if (s.indexOf("FINISHED")  !== -1 || s.indexOf("COMPLETED") !== -1) return "completed";
        if (s.indexOf("RELEASING") !== -1 || s.indexOf("ONGOING")   !== -1) return "ongoing";
        if (s.indexOf("NOT_YET")   !== -1 || s.indexOf("UPCOMING")  !== -1) return "upcoming";
        return "unknown";
    }

    function toMultimediaItem(edge, sourceName) {
        if (!edge || !edge._id || !isAnimeRecord(edge)) return null;
        var typeStr = String(edge.type || "").toLowerCase();
        var itemType = typeStr.indexOf("movie") !== -1 ? "movie" : "anime";
        var tags = uniqueStrings((Array.isArray(edge.genres) ? edge.genres : []).concat(Array.isArray(edge.tags) ? edge.tags : []));
        var poster = normalizeImageUrl(edge.thumbnail);
        var title = preferredTitle(edge);
        var year = edge.airedStart && edge.airedStart.year ? Number(edge.airedStart.year) : 0;
        return new MultimediaItem({
            title: title,
            titles: { display: title, english: edge.englishName || null, romaji: edge.name || null, native: edge.nativeName || null },
            alternativeTitles: uniqueStrings([edge.englishName, edge.name, edge.nativeName]),
            url: sourceId(sourceName || "allanime", edge._id, { malId: edge.idMal || null }),
            posterUrl: poster,
            coverUrl: normalizeImageUrl(edge.coverImage || edge.banner, poster),
            bannerUrl: normalizeImageUrl(edge.banner || edge.coverImage, poster),
            type: itemType,
            format: edge.type || null,
            year: year,
            description: normalizeText(edge.description).substring(0, 5000),
            status: getStatusFromText(edge.status),
            releaseDate: normalizeDate(edge.airedStart && edge.airedStart.iso || edge.startDate),
            tags: tags,
            genres: tags,
            score: numberOrNull(edge.averageScore) === null ? 0 : Number(edge.averageScore) / 10,
            syncData: { source: sourceName || "allanime", allanimeId: edge._id, malId: edge.idMal || null, anilistId: edge.idAniList || null },
            headers: HEADERS
        });
    }

    // Adapt a Jikan anime record into an anime-only MultimediaItem.
    function jikanToMultimediaItem(anime) {
        if (!anime || !anime.mal_id || !isAnimeRecord(anime)) return null;
        var title = firstNonEmpty(anime.title_english, anime.title, anime.title_japanese, "Unknown");
        var imageSet = anime.images && (anime.images.webp || anime.images.jpg) || {};
        var img = normalizeImageUrl(firstNonEmpty(imageSet.large_image_url, imageSet.image_url));
        var banner = normalizeImageUrl(firstNonEmpty(anime.trailer && anime.trailer.images && anime.trailer.images.maximum_image_url, img), img);
        var year = anime.year || (anime.aired && anime.aired.prop && anime.aired.prop.from && anime.aired.prop.from.year) || 0;
        var tags = [];
        (anime.genres || []).concat(anime.themes || [], anime.demographics || []).forEach(function (g) {
            if (g && g.name && tags.indexOf(g.name) === -1) tags.push(g.name);
        });
        var alternativeTitles = uniqueStrings([anime.title, anime.title_english, anime.title_japanese].concat(anime.title_synonyms || []));
        return new MultimediaItem({
            title: title,
            titles: { display: title, english: anime.title_english || null, native: anime.title_japanese || null, synonyms: anime.title_synonyms || [] },
            alternativeTitles: alternativeTitles,
            url: sourceId("jikan", anime.mal_id, { malId: anime.mal_id, anilistId: anime.anilist_id || null }),
            posterUrl: img,
            coverUrl: banner,
            bannerUrl: banner,
            type: anime.type && String(anime.type).toLowerCase() === "movie" ? "movie" : "anime",
            format: anime.type || null,
            year: Number(year) || 0,
            description: normalizeText(anime.synopsis).substring(0, 5000),
            background: normalizeText(anime.background),
            status: getStatusFromText(anime.status),
            releaseDate: normalizeDate(anime.aired && anime.aired.from),
            endDate: normalizeDate(anime.aired && anime.aired.to),
            season: anime.season || null,
            seasonYear: anime.year || null,
            broadcast: anime.broadcast || null,
            tags: tags,
            genres: (anime.genres || []).map(function (g) { return g.name; }),
            score: numberOrNull(anime.score) === null ? 0 : Number(anime.score) / 10,
            rank: anime.rank || null,
            popularity: anime.popularity || null,
            members: anime.members || null,
            voteCount: anime.scored_by || null,
            duration: anime.duration ? parseInt(String(anime.duration), 10) || 0 : 0,
            episodeCount: anime.episodes || null,
            contentRating: anime.rating || null,
            studios: (anime.studios || []).map(function (s) { return s.name; }),
            producers: (anime.producers || []).map(function (s) { return s.name; }),
            licensors: (anime.licensors || []).map(function (s) { return s.name; }),
            trailer: anime.trailer && anime.trailer.youtube_id ? new Trailer({ name: "Trailer", trailerId: anime.trailer.youtube_id, thumbnail: anime.trailer.images && anime.trailer.images.image_url || img }) : null,
            syncData: { source: "jikan", malId: anime.mal_id, anilistId: anime.anilist_id || null },
            headers: HEADERS
        });
    }

    function kitsuToMultimediaItem(resource) {
        if (!resource || !resource.id || !resource.attributes || !isAnimeRecord({ type: "anime" })) return null;
        var attrs = resource.attributes;
        var poster = normalizeImageUrl(attrs.posterImage && firstNonEmpty(attrs.posterImage.large, attrs.posterImage.original, attrs.posterImage.medium));
        var banner = normalizeImageUrl(attrs.coverImage && firstNonEmpty(attrs.coverImage.large, attrs.coverImage.original, attrs.coverImage.medium), poster);
        var titleSet = attrs.titles || {};
        var title = firstNonEmpty(titleSet.en, titleSet.en_jp, titleSet.ja_jp, attrs.canonicalTitle, "Unknown");
        var alternativeTitles = uniqueStrings([attrs.canonicalTitle, titleSet.en, titleSet.en_jp, titleSet.ja_jp].concat(attrs.abbreviatedTitles || []));
        var year = attrs.startDate ? parseInt(String(attrs.startDate).substring(0, 4), 10) || 0 : 0;
        return new MultimediaItem({
            title: title,
            titles: { display: title, english: titleSet.en || null, romaji: titleSet.en_jp || null, native: titleSet.ja_jp || null },
            alternativeTitles: alternativeTitles,
            url: sourceId("kitsu", resource.id, {}),
            posterUrl: poster,
            coverUrl: banner,
            bannerUrl: banner,
            type: String(attrs.subtype || "tv").toLowerCase() === "movie" ? "movie" : "anime",
            format: attrs.subtype || null,
            year: year,
            description: normalizeText(firstNonEmpty(attrs.synopsis, attrs.description)).substring(0, 5000),
            status: getStatusFromText(attrs.status),
            releaseDate: normalizeDate(attrs.startDate),
            endDate: normalizeDate(attrs.endDate),
            episodeCount: attrs.episodeCount || null,
            duration: attrs.episodeLength || null,
            contentRating: attrs.ageRating || null,
            tags: [],
            genres: [],
            score: attrs.averageRating ? Number(attrs.averageRating) / 10 : 0,
            popularity: attrs.popularityRank || null,
            rank: attrs.ratingRank || null,
            members: attrs.userCount || null,
            trailer: attrs.youtubeVideoId ? new Trailer({ name: "Trailer", trailerId: attrs.youtubeVideoId, thumbnail: poster }) : null,
            syncData: { source: "kitsu", kitsuId: resource.id },
            headers: HEADERS
        });
    }

    // ============================================================================
    // METADATA ENRICHMENT — AniList + AniZip
    // ============================================================================

    var ANILIST_QUERY = `
    query ($search: String, $id: Int, $idMal: Int) {
      Media(search: $search, id: $id, idMal: $idMal, type: ANIME) {
        id idMal
        bannerImage
        coverImage { extraLarge large medium color }
        title { english romaji native userPreferred }
        startDate { year month day }
        endDate { year month day }
        genres tags { name rank isMediaSpoiler }
        description(asHtml: false)
        averageScore meanScore popularity status episodes duration
        format type countryOfOrigin isAdult season seasonYear
        source ageRating contentRating
        studios(isMain: true) { nodes { name isAnimationStudio } }
        staff(perPage: 6) { edges { role node { name { full } image { large } } } }
        characters(perPage: 10) {
          edges { role voiceActors(language: JAPANESE) { name { full } image { large } } node { name { full } image { large } } }
        }
        trailer { id site thumbnail }
        relations { edges { relationType node { id idMal title { english romaji userPreferred } coverImage { large } format type } } }
        recommendations(perPage: 12) {
          edges {
            node {
              mediaRecommendation {
                id idMal title { english romaji userPreferred } coverImage { large } format averageScore
              }
            }
          }
        }
        nextAiringEpisode { episode airingAt timeUntilAiring }
      }
    }`;

    function mapAniListMedia(media) {
        if (!media) return null;
        var titles = media.title || {};
        var poster = normalizeImageUrl(media.coverImage && firstNonEmpty(media.coverImage.extraLarge, media.coverImage.large, media.coverImage.medium));
        var tags = (media.genres || []).concat((media.tags || []).map(function (tag) { return tag && tag.name; })).filter(Boolean);
        return {
            id: media.id || null,
            idMal: media.idMal || null,
            title: firstNonEmpty(titles.english, titles.romaji, titles.native, titles.userPreferred),
            titles: titles,
            alternativeTitles: uniqueStrings([titles.english, titles.romaji, titles.native, titles.userPreferred]),
            posterUrl: poster,
            bannerUrl: normalizeImageUrl(media.bannerImage, poster),
            description: normalizeText(media.description),
            format: media.format || media.type || null,
            type: media.type || null,
            status: getStatusFromText(media.status),
            startDate: media.startDate || null,
            endDate: media.endDate || null,
            season: media.season || null,
            seasonYear: media.seasonYear || null,
            episodeCount: media.episodes || null,
            duration: media.duration || null,
            score: media.averageScore ? Number(media.averageScore) / 10 : 0,
            meanScore: media.meanScore ? Number(media.meanScore) / 10 : 0,
            popularity: media.popularity || null,
            tags: uniqueStrings(tags),
            studios: media.studios && media.studios.nodes ? media.studios.nodes.map(function (node) { return node.name; }) : [],
            trailer: media.trailer || null,
            relations: media.relations || null,
            recommendations: media.recommendations || null,
            nextAiringEpisode: media.nextAiringEpisode || null,
            raw: media
        };
    }

    async function getAniListMedia(opts) {
        opts = opts || {};
        var variables = { type: "ANIME" };
        if (opts.id)         variables.id    = opts.id;
        else if (opts.idMal) variables.idMal = opts.idMal;
        else if (opts.search) variables.search = opts.search;

        var cacheKey = "anilist:" + JSON.stringify(variables);
        var cached = getCached(cacheKey, CACHE_TTL.metadata);
        if (cached !== null) return cached;

        return withRequestCoalescing(cacheKey, async function () {
            var payload = JSON.stringify({ query: ANILIST_QUERY, variables: variables });
            var res;
            try {
                res = await http_post("https://graphql.anilist.co", { "Content-Type": "application/json" }, payload);
            } catch (e) {
                try { res = await http_post("https://graphql.anilist.co", payload, { "Content-Type": "application/json" }); }
                catch (e2) { res = null; }
            }
            if (!res || res.status !== 200) {
                // AniList can be temporarily disabled. Cache the miss briefly to prevent
                // duplicate enrichment requests from every detail card.
                setCached(cacheKey, null);
                return null;
            }
            try {
                var data = JSON.parse(res.body || "{}");
                var media = mapAniListMedia(data.data && data.data.Media);
                setCached(cacheKey, media);
                return media;
            } catch (e) {
                setCached(cacheKey, null);
                return null;
            }
        });
    }

    async function getAniZipData(malId) {
        if (!malId) return null;
        var cacheKey = "anizip:" + malId;
        var cached = getCached(cacheKey, CACHE_TTL.metadata);
        if (cached !== null) return cached;

        try {
            var res = await requestWithTimeout(function () { return http_get("https://api.ani.zip/mappings?mal_id=" + malId); }, "ANIZIP");
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
    // JIKAN FALLBACK (REST)
    // ============================================================================

    var JIKAN_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json"
    };

    async function jikanGet(path) {
        try {
            var res = await requestWithTimeout(function () { return http_get("https://api.jikan.moe/v4" + path, JIKAN_HEADERS); }, "JIKAN");
            if (!res || res.status !== 200) return null;
            var json = JSON.parse(res.body || "{}");
            return json.data || null;
        } catch (e) {
            return null;
        }
    }

    async function jikanEpisodePages(malId) {
        var episodes = [];
        for (var page = 1; page <= 20; page++) {
            try {
                var res = await requestWithTimeout(function () {
                    return http_get("https://api.jikan.moe/v4/anime/" + encodeURIComponent(malId) + "/episodes?page=" + page, JIKAN_HEADERS);
                }, "JIKAN_EPISODES");
                if (!res || res.status !== 200) break;
                var json = JSON.parse(res.body || "{}");
                var pageItems = Array.isArray(json.data) ? json.data : [];
                episodes = episodes.concat(pageItems);
                if (!json.pagination || !json.pagination.has_next_page || !pageItems.length) break;
            } catch (e) {
                logError("jikanEpisodes", e);
                break;
            }
        }
        return episodes;
    }

    var KITSU_HEADERS = { "Accept": "application/vnd.api+json", "User-Agent": JIKAN_HEADERS["User-Agent"] };

    async function kitsuGet(path) {
        try {
            var res = await requestWithTimeout(function () { return http_get("https://kitsu.io/api/edge" + path, KITSU_HEADERS); }, "KITSU");
            if (!res || res.status !== 200) return null;
            return JSON.parse(res.body || "{}");
        } catch (e) {
            return null;
        }
    }

    function getHiAnimeBase() {
        var base = getHiAnimeBaseUrl();
        return base ? base : null;
    }

    async function hiAnimeGet(path) {
        var base = getHiAnimeBase();
        if (!base) return null;
        try {
            var res = await requestWithTimeout(function () { return http_get(base + (path.charAt(0) === "/" ? path : "/" + path), {
                "Accept": "application/json",
                "User-Agent": HEADERS["User-Agent"]
            }); }, "HIANIME");
            if (!res || res.status < 200 || res.status >= 300) return null;
            return JSON.parse(res.body || "{}");
        } catch (e) {
            return null;
        }
    }

    function unwrapApiData(value) {
        if (!value) return null;
        if (value.success === false) return null;
        return value.data !== undefined ? value.data : value;
    }

    function normalizeHiAnimeList(value) {
        var body = unwrapApiData(value) || {};
        var list = Array.isArray(body) ? body : (body.animes || body.results || body.items || []);
        return list.filter(isAnimeRecord).map(function (anime) {
            var mapped = {
                mal_id: anime.mal_id || anime.malId,
                title: anime.title || anime.name,
                title_english: anime.alternativeTitle,
                synopsis: anime.synopsis,
                type: anime.type,
                images: { jpg: { large_image_url: anime.poster || anime.image } },
                score: anime.score || anime.rating,
                aired: { from: anime.aired && anime.aired.from },
                genres: anime.genres || []
            };
            var item = mapped.mal_id ? jikanToMultimediaItem(mapped) : null;
            if (!item) return new MultimediaItem({
                title: anime.title || anime.name || "Unknown",
                url: sourceId("hianime", anime.id || anime.slug, {}),
                posterUrl: anime.poster || anime.image || getPosterFallback(),
                type: String(anime.type || "TV").toLowerCase() === "movie" ? "movie" : "anime",
                description: anime.synopsis || "",
                year: anime.year || 0,
                tags: anime.genres || [],
                syncData: { source: "hianime", hianimeId: anime.id || anime.slug },
                headers: HEADERS
            });
            item.syncData = { source: "hianime", hianimeId: anime.id || anime.slug, malId: anime.mal_id || anime.malId || null };
            item.url = sourceId("hianime", anime.id || anime.slug, { malId: anime.mal_id || anime.malId || null });
            return item;
        }).filter(Boolean);
    }

    async function hiAnimeSearch(query) {
        var results = [];
        var page = 1;
        while (page <= 5) {
            var result = await hiAnimeGet("/api/v2/search?keyword=" + encodeURIComponent(query) + "&page=" + page);
            var items = normalizeHiAnimeList(result);
            if (!items.length) break;
            results = results.concat(items);
            var body = unwrapApiData(result) || {};
            var hasNext = body.hasNextPage || body.hasNext || (body.pagination && body.pagination.hasNextPage);
            if (!hasNext) break;
            page++;
        }
        return results;
    }

    // ============================================================================
    // STREAM PIPELINE
    // ============================================================================

    var QUALITY_REGEX     = /(\d{3,4})p/i;
    var RESOLUTION_REGEX  = /RESOLUTION=\d+x(\d+)/;

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
            if (h >=  720) return "720p";
            if (h >=  480) return "480p";
            if (h >=  360) return "360p";
        }
        return null;
    }

    async function expandM3u8Streams(m3u8Url, sourceName, referer, subtitles, streamResults) {
        try {
            var m3u8Headers = Object.assign({}, HEADERS);
            if (referer) m3u8Headers["Referer"] = referer;

            var res;
            try {
                res = await requestWithTimeout(function () { return http_get(m3u8Url, m3u8Headers); }, "HLS");
            } catch (e) {
                res = await requestWithTimeout(function () { return http_get(m3u8Url, JSON.stringify(m3u8Headers)); }, "HLS");
            }

            if (!res || res.status !== 200) {
                if (!isPlayableMediaUrl(m3u8Url)) return;
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
                if (!isPlayableMediaUrl(m3u8Url)) return;
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

    function isPlayableMediaUrl(value) {
        if (!value || typeof value !== "string") return false;
        var clean = value.trim().replace(/[\\'\"<>]+$/g, "");
        if (!/^https?:\/\//i.test(clean)) return false;
        if (/\.(m3u8|mpd|mp4|webm|m4v)(?:[?#]|$)/i.test(clean)) return true;
        return /(?:\/master(?:\.m3u8)?|\/(?:playlist|manifest)(?:[.?/]|$)|[?&](?:file|url|source)=)/i.test(clean);
    }

    function findMediaUrlsInHtml(html, baseUrl) {
        if (!html) return [];
        var urls = [];
        var patterns = [
            /https?:\/\/[^\s"'<>\\]+/gi,
            /(?:file|source|src|hls|dash)\s*[:=]\s*["']([^"']+)["']/gi,
            /(?:file|source|src|hls|dash)\s*[:=]\s*`([^`]+)`/gi
        ];
        for (var i = 0; i < patterns.length; i++) {
            var matches;
            while ((matches = patterns[i].exec(html)) !== null) {
                var candidate = matches[1] || matches[0];
                candidate = candidate.replace(/^["'`\s]*(?:file|source|src|hls|dash)\s*[:=]\s*/i, "").replace(/[\'"`,;<>]+$/g, "");
                candidate = absoluteUrl(candidate, baseUrl);
                if (isPlayableMediaUrl(candidate) && urls.indexOf(candidate) === -1) urls.push(candidate);
            }
        }
        return urls;
    }

    function extractorInstances() {
        // The host may provide a full extractor registry. Keep this plugin dependency-free so
        // the SkyStream bundler works even when optional npm extractors are unavailable.
        var classes = [];
        if (typeof globalThis !== "undefined" && globalThis.SkyStreamExtractors) {
            var registry = globalThis.SkyStreamExtractors;
            classes = [registry.DoodExtractor, registry.Filemoon, registry.HubCloud, registry.MixDrop,
                registry.RabbitStream, registry.StreamSb, registry.StreamTape, registry.StreamWish,
                registry.VidHidePro, registry.Voe];
        }
        var result = [];
        for (var i = 0; i < classes.length; i++) {
            try { if (classes[i]) result.push(new classes[i]()); } catch (e) { /* optional extractor */ }
        }
        return result;
    }

    function extractorMatches(instance, url) {
        if (!instance || !instance.mainUrl) return false;
        try {
            return new URL(url).hostname.toLowerCase().endsWith(new URL(instance.mainUrl).hostname.toLowerCase());
        } catch (e) { return false; }
    }

    async function resolveWithBundledExtractor(url, referer, sourceName, subtitles, streamResults) {
        var instances = extractorInstances();
        for (var i = 0; i < instances.length; i++) {
            var instance = instances[i];
            if (!extractorMatches(instance, url)) continue;
            try {
                var links = await instance.getUrl(url, referer);
                if (!Array.isArray(links)) continue;
                for (var j = 0; j < links.length; j++) {
                    var link = links[j];
                    if (!link || !isPlayableMediaUrl(link.url)) continue;
                    var mediaUrl = absoluteUrl(link.url, url);
                    if (/\.m3u8(?:[?#]|$)/i.test(mediaUrl)) {
                        await expandM3u8Streams(mediaUrl, sourceName + " / " + (link.source || instance.name), link.headers && link.headers.Referer || referer, subtitles, streamResults);
                    } else {
                        streamResults.push(new StreamResult({
                            url: mediaUrl,
                            source: sourceName + " / " + (link.source || instance.name),
                            quality: qualityFromText(String(link.quality || "")) || qualityFromText(mediaUrl) || "Auto",
                            headers: link.headers || (referer ? { Referer: referer } : HEADERS),
                            subtitles: subtitles || []
                        }));
                    }
                }
                if (streamResults.length > 0) return true;
            } catch (e) { logError("extractor:" + instance.name, e); }
        }
        return false;
    }

    async function resolveVidStackLike(url, sourceName, subtitles, streamResults) {
        try {
            var res = await requestWithTimeout(function () { return http_get(url, HEADERS); }, "EMBED");
            if (!res || res.status !== 200) return false;
            var html = res.body || "";

            // Look for AES-CBC encrypted blob (--<base64>).
            var blobMatch = html.match(/--([A-Za-z0-9+/=]+)/);
            if (blobMatch) {
                try {
                    var decrypted = await crypto.decryptAES(blobMatch[1], "kiemtienmua911ca", "");
                    if (decrypted && decrypted.indexOf("http") !== -1) {
                        await expandM3u8Streams(decrypted, sourceName, url, subtitles, streamResults);
                        return true;
                    }
                } catch (e) { /* fall through to media-URL probe */ }
            }

            var mediaUrls = findMediaUrlsInHtml(html, url);
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
            var res = await requestWithTimeout(function () { return http_get(url, HEADERS); }, "EMBED");
            if (!res || res.status !== 200) return false;
            var html = res.body || "";

            // StreamWish uses jwplayer; sources is a JS array literal.
            var sourcesMatch = html.match(/sources\s*:\s*\[([^\]]+)\]/);
            if (sourcesMatch) {
                var fileMatch = sourcesMatch[1].match(/file\s*:\s*["']([^"']+)["']/);
                if (fileMatch) {
                    await expandM3u8Streams(fileMatch[1], sourceName, url, subtitles, streamResults);
                    return true;
                }
            }

            var mediaUrls = findMediaUrlsInHtml(html, url);
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
            var res = await requestWithTimeout(function () { return http_get(url, HEADERS); }, "EMBED");
            if (!res || res.status !== 200) return false;
            var html = res.body || "";

            // Filemoon packs with eval; use the SDK's getAndUnpack if available.
            var unpacked = (typeof getAndUnpack === "function") ? getAndUnpack(html) : html;
            var mediaUrls = findMediaUrlsInHtml(unpacked);

            if (mediaUrls.length === 0) {
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
            var res = await requestWithTimeout(function () { return http_get(url, HEADERS); }, "EMBED");
            if (!res || res.status !== 200) return false;
            var html = res.body || "";
            var mediaUrls = findMediaUrlsInHtml(html, url);
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

    async function resolveEmbeddedSource(url, sourceName, subtitles, streamResults, referer) {
        if (!url) return false;
        url = absoluteUrl(url, referer || "https://allanime.day");
        var lowerUrl = url.toLowerCase();

        if (!isPlayableMediaUrl(url) && await resolveWithBundledExtractor(url, referer, sourceName, subtitles, streamResults)) {
            return true;
        }

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

        // Prefer the host runtime extractor when present, then bundled extractors.
        if (typeof globalThis.loadExtractor === "function") {
            try {
                var beforeCount = streamResults.length;
                var resolved = false;
                var extractorResult = await globalThis.loadExtractor(url, referer);
                var results = Array.isArray(extractorResult) ? extractorResult : [];
                for (var i = 0; i < results.length; i++) {
                    var r = results[i];
                    if (r && isPlayableMediaUrl(r.url)) {
                        streamResults.push(new StreamResult({
                            url: absoluteUrl(r.url, url),
                            source: sourceName + " - " + (r.source || "Auto"),
                            quality: r.quality || qualityFromText(r.url) || "Auto",
                            headers: r.headers || (referer ? { Referer: referer } : HEADERS),
                            subtitles: subtitles || []
                        }));
                        resolved = true;
                    }
                }
                if (resolved || streamResults.length > beforeCount) return true;
            } catch (e) { logError("runtimeExtractor", e); }
        }

        if (await resolveWithBundledExtractor(url, referer, sourceName, subtitles, streamResults)) return true;
        return await resolveDirectEmbed(url, sourceName, subtitles, streamResults);
    }

    async function resolveSourceEntries(sourceData, subtitles) {
        var streamResults = [];
        if (!sourceData) return streamResults;

        var links = [];
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

            var failKey = "streamfail:" + link.url;
            if (wasRecentlyFailed(failKey)) continue;

            try {
                // Relative links are AllAnime's per-source JSON endpoint.
                if (link.url.startsWith("/")) {
                    var absUrl = absoluteUrl(link.url.replace(/\.json.*$/, "") + ".json?", "https://allanime.day");
                    try {
                        var jsonRes = await http_get(absUrl, HEADERS);
                        if (jsonRes && jsonRes.status === 200) {
                            var jsonData = JSON.parse(jsonRes.body);
                            if (jsonData.links && Array.isArray(jsonData.links)) {
                                for (var k = 0; k < jsonData.links.length; k++) {
                                    var subLink = jsonData.links[k];
                                    if (subLink && (subLink.link || subLink.url)) {
                                        var ok = await resolveEmbeddedSource(
                                            subLink.link || subLink.url,
                                            link.sourceName + " - " + (subLink.resolution || subLink.quality || "Auto"),
                                            subtitles,
                                            streamResults,
                                            absUrl
                                        );
                                        if (!ok) setCachedFailure(failKey);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        logError("relativeLink", e);
                    }
                } else {
                    var ok = await resolveEmbeddedSource(link.url, link.sourceName, subtitles, streamResults, link.referer || null);
                    if (!ok) setCachedFailure(failKey);
                }
            } catch (e) {
                logError("sourceEntry", e);
            }
        }

        // Deduplicate by url|quality.
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
    // PLUGIN FUNCTIONS (modern async, return data directly)
    // ============================================================================

    function dedupeItems(items) {
        var seen = {};
        var result = [];
        (items || []).forEach(function (item) {
            if (!item || !isAnimeRecord(item)) return;
            var key = getAnimeMergeKey({
                title: item.title,
                year: item.year,
                syncData: item.syncData || {}
            });
            if (!key || seen[key]) return;
            seen[key] = true;
            result.push(item);
        });
        return result;
    }

    function providerSequence() {
        var mode = getProviderMode();
        var preferred = getProviderConfig();
        if (mode !== "auto") {
            var forced = getProviderConfig(mode);
            return forced.kind === "hianime" && !getHiAnimeBase() ? [getProviderConfig("AllAnime"), getProviderConfig("Jikan"), getProviderConfig("Kitsu")] : [forced];
        }
        var list = [preferred];
        ["AllAnime", "Jikan", "Kitsu", "HiAnime"].forEach(function (id) {
            var config = getProviderConfig(id);
            if (list.indexOf(config) === -1 && (config.kind !== "hianime" || getHiAnimeBase())) list.push(config);
        });
        return list;
    }

    async function allAnimeHome() {
        var now = new Date();
        var month = now.getMonth() + 1;
        var year = now.getFullYear();
        var season = month <= 3 ? "Winter" : month <= 6 ? "Spring" : month <= 9 ? "Summer" : "Fall";
        var categories = {
            "Trending": { search: { season: season, year: year }, translationType: "sub", countryOrigin: "ALL" },
            "Popular":  { search: {}, translationType: "sub", countryOrigin: "ALL" },
            "Latest":   { search: {}, translationType: "sub", countryOrigin: "ALL" },
            "Movies":   { search: { types: ["Movie"] }, translationType: "sub", countryOrigin: "ALL" }
        };
        var homeData = {};
        var results = await Promise.allSettled(Object.entries(categories).map(async function (entry) {
            var res = await safeQueryGraph(Object.assign({}, entry[1], { limit: 26, page: 1 }), HASHES.mainPage, "GET");
            if (!res || !res.data || !res.data.shows) return { name: entry[0], items: [] };
            return {
                name: entry[0],
                items: (res.data.shows.edges || []).filter(isAnimeRecord).filter(hasEpisodes).map(function (edge) {
                    return toMultimediaItem(edge, "allanime");
                }).filter(Boolean)
            };
        }));
        results.forEach(function (result) {
            if (result.status === "fulfilled" && result.value.items.length) homeData[result.value.name] = dedupeItems(result.value.items);
        });
        return homeData;
    }

    async function jikanHome() {
        var homeData = {};
        var topAiring = await jikanGet("/top/anime?filter=airing&limit=25&page=1");
        var topAll = await jikanGet("/top/anime?limit=25&page=1");
        var upcoming = await jikanGet("/seasons/upcoming?limit=25&page=1");
        if (topAiring && topAiring.length) homeData.Trending = dedupeItems(topAiring.map(jikanToMultimediaItem).filter(Boolean));
        if (topAll && topAll.length) homeData.Popular = dedupeItems(topAll.map(jikanToMultimediaItem).filter(Boolean));
        if (upcoming && upcoming.length) homeData.Upcoming = dedupeItems(upcoming.map(jikanToMultimediaItem).filter(Boolean));
        return homeData;
    }

    async function kitsuHome() {
        var result = await kitsuGet("/anime?page%5Blimit%5D=20&sort=-averageRating");
        var items = result && result.data ? result.data.map(kitsuToMultimediaItem).filter(Boolean) : [];
        return items.length ? { Popular: dedupeItems(items) } : {};
    }

    async function hiAnimeHome() {
        var result = await hiAnimeGet("/api/v2/home");
        var data = unwrapApiData(result) || {};
        var homeData = {};
        ["spotlight", "trending", "topAiring", "mostPopular", "mostFavorite", "latestEpisode", "newAdded", "topUpcoming"].forEach(function (key) {
            if (Array.isArray(data[key])) {
                var items = normalizeHiAnimeList(data[key]);
                if (items.length) homeData[key] = dedupeItems(items);
            }
        });
        return homeData;
    }

    async function _getHome() {
        var cacheKey = "home:" + getProviderMode() + ":" + getPreferenceValue("providerId", "AllAnime");
        var cached = getCached(cacheKey, CACHE_TTL.home);
        if (cached !== null) return cached;
        return withRequestCoalescing(cacheKey, async function () {
            log("home", "Fetching anime home sections");
            var homeData = {};
            var providers = providerSequence();
            for (var i = 0; i < providers.length; i++) {
                var config = providers[i];
                try {
                    var next = config.kind === "allanime" ? await allAnimeHome() : config.kind === "jikan" ? await jikanHome() : config.kind === "kitsu" ? await kitsuHome() : await hiAnimeHome();
                    Object.keys(next || {}).forEach(function (key) {
                        homeData[key] = dedupeItems((homeData[key] || []).concat(next[key] || []));
                    });
                } catch (e) { logError("home:" + config.id, e); }
            }
            if (Object.keys(homeData).length === 0) throw new Error("HOME_FALLBACK_FAILED");
            setCached(cacheKey, homeData);
            log("home", "Returning " + Object.keys(homeData).length + " anime sections");
            return homeData;
        });
    }

    async function allAnimeSearch(query) {
        var results = [];
        for (var page = 1; page <= 5; page++) {
            var res = await safeQueryGraph({ search: { query: query }, limit: 30, page: page, translationType: "sub", countryOrigin: "ALL" }, HASHES.mainPage, "GET");
            if (!res || !res.data || !res.data.shows) break;
            var edges = (res.data.shows.edges || []).filter(isAnimeRecord).filter(hasEpisodes).map(function (edge) {
                return toMultimediaItem(edge, "allanime");
            }).filter(Boolean);
            results = results.concat(edges);
            if (!edges.length || !res.data.shows.pageInfo || !res.data.shows.pageInfo.hasNextPage) break;
        }
        return results;
    }

    async function kitsuSearch(query) {
        // Kitsu rejects page sizes above 20 with HTTP 400. Follow the API's
        // opaque next link instead of constructing pagination URLs ourselves.
        var allResults = [];
        var nextUrl = "/anime?filter%5Btext%5D=" + encodeURIComponent(query) + "&page%5Blimit%5D=20";
        var pageCount = 0;
        while (nextUrl && pageCount < 10) {
            var result = await kitsuGet(nextUrl);
            if (!result) break;
            if (Array.isArray(result.data)) {
                allResults = allResults.concat(result.data.map(kitsuToMultimediaItem).filter(Boolean));
            }
            var next = result.links && result.links.next;
            nextUrl = next ? String(next).replace("https://kitsu.io/api/edge", "") : null;
            pageCount++;
        }
        return allResults;
    }

    async function _search(query) {
        var normalizedQuery = normalizeText(query).toLocaleLowerCase();
        if (!normalizedQuery) return [];
        log("search", 'Query: "' + normalizedQuery + '"');
        var cacheKey = "search:" + normalizedQuery;
        var cached = getCached(cacheKey, CACHE_TTL.search);
        if (cached !== null) return cached;
        return withRequestCoalescing(cacheKey, async function () {
            var results = [];
            var providers = providerSequence();
            for (var i = 0; i < providers.length; i++) {
                try {
                    var config = providers[i];
                    var next = config.kind === "allanime" ? await allAnimeSearch(normalizedQuery) : config.kind === "jikan" ? ((await jikanGet("/anime?q=" + encodeURIComponent(normalizedQuery) + "&limit=20&order_by=score&sort=desc")) || []).map(jikanToMultimediaItem).filter(Boolean) : config.kind === "kitsu" ? await kitsuSearch(normalizedQuery) : await hiAnimeSearch(normalizedQuery);
                    results = dedupeItems(results.concat(next || []));
                } catch (e) { logError("search:" + providers[i].id, e); }
            }
            setCached(cacheKey, results);
            log("search", "Returning " + results.length + " anime results");
            return results;
        });
    }

    async function _load(url) {
        log("load", "Loading: " + String(url).substring(0, 100));
        var sourcePayload = parseSourceId(url);
        var providerId = sourcePayload.source || "allanime";
        var providerIdValue = sourcePayload.id || url;
        var cacheKey = "detail:" + url;
        var cached = getCached(cacheKey, CACHE_TTL.metadata);
        if (cached) {
            log("load", "Cache hit");
            return cached;
        }

        var show = null;
        if (providerId === "allanime" || providerId === "AllAnime") {
            var res = await safeQueryGraph({ _id: providerIdValue }, HASHES.detail, "GET");
            if (res && res.data && res.data.show && isAnimeRecord(res.data.show)) show = res.data.show;
        } else if (providerId === "kitsu") {
            var kitsuDetail = await kitsuGet("/anime/" + encodeURIComponent(providerIdValue));
            if (kitsuDetail && kitsuDetail.data) {
                var kitsuItem = kitsuToMultimediaItem(kitsuDetail.data);
                var kitsuMappings = await kitsuGet("/anime/" + encodeURIComponent(providerIdValue) + "/mappings?page%5Blimit%5D=20");
                var kitsuMalId = null;
                ((kitsuMappings && kitsuMappings.data) || []).forEach(function (mapping) {
                    var site = mapping.attributes && mapping.attributes.externalSite;
                    var externalId = mapping.attributes && mapping.attributes.externalId;
                    if (site === "myanimelist/anime") kitsuMalId = Number(externalId) || kitsuMalId;
                    if (site === "anilist/anime" && kitsuItem) kitsuItem.syncData.anilistId = Number(externalId) || null;
                });
                if (kitsuItem && kitsuMalId) kitsuItem.syncData.malId = kitsuMalId;
                var kitsuEpisodes = await kitsuGet("/anime/" + encodeURIComponent(providerIdValue) + "/episodes?page%5Blimit%5D=20");
                var kitsuEpisodeList = [];
                var episodePage = kitsuEpisodes;
                var episodePages = 0;
                while (episodePage && Array.isArray(episodePage.data) && episodePages < 10) {
                    kitsuEpisodeList = kitsuEpisodeList.concat(episodePage.data);
                    var nextUrl = episodePage.links && episodePage.links.next;
                    if (!nextUrl) break;
                    var nextPath = nextUrl.replace("https://kitsu.io/api/edge", "");
                    episodePage = await kitsuGet(nextPath);
                    episodePages++;
                }
                if (kitsuItem) {
                    kitsuItem.episodes = kitsuEpisodeList.map(function (episode) {
                        var attrs = episode.attributes || {};
                        var epNum = attrs.number || attrs.relativeNumber || 0;
                        var titles = attrs.titles || {};
                        return new Episode({
                            name: firstNonEmpty(titles.en_us, titles.en, titles.en_jp, attrs.canonicalTitle, "Episode " + epNum),
                            url: sourceId("kitsu", providerIdValue, { episode: String(epNum), dubStatus: "sub", malId: kitsuMalId || null }),
                            season: attrs.seasonNumber || 1,
                            episode: Number(epNum) || 0,
                            description: normalizeText(firstNonEmpty(attrs.synopsis, attrs.description)),
                            posterUrl: normalizeImageUrl(attrs.thumbnail && attrs.thumbnail.original, kitsuItem.posterUrl),
                            runtime: attrs.length || kitsuItem.duration || null,
                            airDate: normalizeDate(attrs.airdate),
                            dubStatus: "subbed",
                            headers: HEADERS
                        });
                    });
                    setCached(cacheKey, kitsuItem);
                    return kitsuItem;
                }
            }
        } else if (providerId === "hianime") {
            var hiResult = unwrapApiData(await hiAnimeGet("/api/v2/anime/" + encodeURIComponent(providerIdValue)));
            if (hiResult && isAnimeRecord(hiResult)) {
                var hiItemList = normalizeHiAnimeList([hiResult]);
                if (hiItemList.length) {
                    var hiItem = hiItemList[0];
                    var hiEpisodes = unwrapApiData(await hiAnimeGet("/api/v2/episodes/" + encodeURIComponent(providerIdValue)));
                    var hiEpisodeList = Array.isArray(hiEpisodes) ? hiEpisodes : (hiEpisodes && (hiEpisodes.episodes || hiEpisodes.items)) || [];
                    hiItem.episodes = hiEpisodeList.map(function (episode, index) {
                        var epNum = episode.episodeNumber || episode.number || index + 1;
                        return new Episode({ name: episode.title || "Episode " + epNum, url: sourceId("hianime", episode.id || providerIdValue, { episode: String(epNum), dubStatus: "sub", malId: sourcePayload.malId || null }), season: 1, episode: Number(epNum), description: episode.description || "", posterUrl: hiItem.posterUrl, dubStatus: "subbed", headers: HEADERS });
                    });
                    setCached(cacheKey, hiItem);
                    return hiItem;
                }
            }
        }

        // Jikan fallback if AllAnime returned nothing (or the id is a MAL id).
        if (!show) {
            log("load", "Primary source returned no detail — trying Jikan/Kitsu");
            var malId = Number(sourcePayload.malId || (providerId === "jikan" ? providerIdValue : url));
            if (!isNaN(malId) && malId > 0) {
                var jikan = await jikanGet("/anime/" + malId + "/full");
                if (jikan) {
                    var item = jikanToMultimediaItem(jikan);
                    var jikanEpisodes = await jikanEpisodePages(jikan.mal_id);
                    if (jikanEpisodes.length) {
                        item.episodes = jikanEpisodes.map(function (episode) {
                            var epNum = Number(episode.episode || episode.number || 0);
                            return new Episode({
                                name: firstNonEmpty(episode.title, episode.title_japanese, episode.title_romanji, "Episode " + epNum),
                                url: sourceId("jikan", jikan.mal_id, { episode: String(epNum), dubStatus: "sub", malId: jikan.mal_id }),
                                season: 1,
                                episode: epNum,
                                description: normalizeText(episode.synopsis),
                                posterUrl: (episode.images && episode.images.jpg && episode.images.jpg.image_url) || item.posterUrl,
                                runtime: episode.duration || jikan.duration || null,
                                airDate: normalizeDate(episode.aired),
                                dubStatus: "subbed",
                                headers: HEADERS
                            });
                        });
                    }
                    if (jikan.synopsis) item.description = String(jikan.synopsis).substring(0, 1000);
                    if (jikan.score)    item.score = jikan.score / 10;
                    if (jikan.duration) item.duration = parseInt(String(jikan.duration), 10) || 24;
                    item.bannerUrl = (jikan.images && jikan.images.jpg && jikan.images.jpg.large_image_url) || item.posterUrl;
                    setCached(cacheKey, item);
                    return item;
                }
            }
            throw new Error("DETAILS_FAILED");
        }

        var title = show.name || show.englishName || show.nativeName || "Unknown";
        var year  = show.airedStart && show.airedStart.year ? show.airedStart.year : null;
        var showType = show.type;

        // Enrich with AniList (in parallel-ish, sequentially is fine and lighter on rate limits).
        var aniMedia = null;
        var aniZip = null;
        if (show.idMal) {
            aniMedia = await getAniListMedia({ idMal: show.idMal });
            aniZip = await getAniZipData(show.idMal);
        }
        if (!aniMedia) aniMedia = await getAniListMedia({ search: title });

        var resolvedTitle = (aniZip && aniZip.titles && aniZip.titles.en) ||
                            show.englishName ||
                            (aniMedia && aniMedia.title) ||
                            title;
        var poster = (aniMedia && aniMedia.posterUrl) || resolvePosterUrl(show.thumbnail);
        var banner = (aniMedia && aniMedia.bannerUrl) || poster;
        var description = (aniMedia && aniMedia.description) || normalizeText(show.description);
        var genres = (aniMedia && aniMedia.tags) || [];
        var averageScore = (aniMedia && aniMedia.score) || 0;
        var status = (aniMedia && aniMedia.status) || getStatusFromText(show.status);
        var totalEpisodes = (aniMedia && aniMedia.episodeCount) || 0;
        var detailEpisodes = [];
        if (aniZip && aniZip.episodes) {
            Object.keys(aniZip.episodes).forEach(function (key) {
                var value = aniZip.episodes[key];
                if (value && value.episode) detailEpisodes.push(value);
            });
        }

        var subEpisodes = (show.availableEpisodesDetail && show.availableEpisodesDetail.sub) || detailEpisodes.map(function (episode) { return episode.episode; });
        var dubEpisodes = (show.availableEpisodesDetail && show.availableEpisodesDetail.dub) || [];
        var allEpisodes = [];

        for (var i = 0; i < subEpisodes.length; i++) {
            var epNum = subEpisodes[i];
            var aniEp = (aniZip && aniZip.episodes) ? aniZip.episodes[epNum] : null;
            allEpisodes.push(new Episode({
                name: (aniEp && aniEp.title && (aniEp.title.en || aniEp.title.ja)) || "Episode " + epNum,
                url: sourceId("allanime", show._id, { episode: String(epNum), dubStatus: "sub", malId: show.idMal || null }),
                season: 1,
                episode: parseInt(epNum, 10),
                description: (aniEp && aniEp.overview) || "",
                posterUrl: (aniEp && aniEp.image) || poster,
                runtime:   (aniEp && aniEp.runtime) || 24,
                airDate:   (aniEp && aniEp.airDate) || null,
                dubStatus: "subbed",
                headers:   HEADERS
            }));
        }

        for (var j = 0; j < dubEpisodes.length; j++) {
            var dubEpNum = dubEpisodes[j];
            var dubAniEp = (aniZip && aniZip.episodes) ? aniZip.episodes[dubEpNum] : null;
            allEpisodes.push(new Episode({
                name: (dubAniEp && dubAniEp.title && (dubAniEp.title.en || dubAniEp.title.ja)) || "Episode " + dubEpNum + " (Dub)",
                url: sourceId("allanime", show._id, { episode: String(dubEpNum), dubStatus: "dub", malId: show.idMal || null }),
                season: 1,
                episode: parseInt(dubEpNum, 10),
                description: (dubAniEp && dubAniEp.overview) || "",
                posterUrl: (dubAniEp && dubAniEp.image) || poster,
                runtime:   (dubAniEp && dubAniEp.runtime) || 24,
                airDate:   (dubAniEp && dubAniEp.airDate) || null,
                dubStatus: "dubbed",
                headers:   HEADERS
            }));
        }

        // If we have neither sub nor dub episode lists (rare), synthesize from totalEpisodes.
        // Do not fabricate episode records when the provider did not expose episode ids.
        // A detail page can still show the episode count while episode playback remains unavailable.

        var recommendations = [];
        if (aniMedia && aniMedia.raw && aniMedia.raw.recommendations && aniMedia.raw.recommendations.edges) {
            for (var k = 0; k < aniMedia.raw.recommendations.edges.length; k++) {
                var rec = aniMedia.raw.recommendations.edges[k].node;
                if (rec && rec.mediaRecommendation) {
                    var mr = rec.mediaRecommendation;
                    recommendations.push(new MultimediaItem({
                        title: (mr.title && (mr.title.english || mr.title.romaji || mr.title.userPreferred)) || "Unknown",
                        url: mr.id ? sourceId("anilist", mr.id, { malId: mr.idMal || null }) : "",
                        posterUrl: (mr.coverImage && mr.coverImage.large) || getPosterFallback(),
                        type: "anime",
                        score: mr.averageScore ? mr.averageScore / 10 : 0,
                        syncData: { source: "anilist", anilistId: mr.id, malId: mr.idMal || null },
                        headers: HEADERS
                    }));
                }
            }
        }

        var cast = [];
        if (aniMedia && aniMedia.raw && aniMedia.raw.characters && aniMedia.raw.characters.edges) {
            for (var l = 0; l < aniMedia.raw.characters.edges.length; l++) {
                var char = aniMedia.raw.characters.edges[l].node;
                if (char) {
                    var va = (char.voiceActors && char.voiceActors[0]) || null;
                    cast.push(new Actor({
                        name: (char.name && char.name.full) || "Unknown",
                        role: (aniMedia.raw.characters.edges[l].role || "Character") + (va ? " (VA: " + ((va.name && va.name.full) || "Unknown") + ")" : ""),
                        image: (char.image && char.image.large) || (va && va.image && va.image.large) || ""
                    }));
                }
            }
        }

        // Merge provider tags with AniList tags (drop NSFW/spoiler flagged for adult surfaces).
        var combinedTags = uniqueStrings(genres || []);
        if (aniMedia && Array.isArray(aniMedia.tags)) {
            aniMedia.tags.forEach(function (tag) {
                if (tag && combinedTags.indexOf(tag) === -1) combinedTags.push(tag);
            });
        }

        var trailer = null;
        if (aniMedia && aniMedia.trailer && aniMedia.trailer.id) {
            if (aniMedia.trailer.site === "youtube" || !aniMedia.trailer.site) {
                trailer = new Trailer({
                    title: "Trailer",
                    thumbnail: aniMedia.trailer.thumbnail || (poster || ""),
                    trailerId: aniMedia.trailer.id
                });
            } else {
                trailer = new Trailer({
                    title: "Trailer",
                    thumbnail: aniMedia.trailer.thumbnail || (poster || ""),
                    url: "https://" + aniMedia.trailer.site + ".com/watch?v=" + aniMedia.trailer.id
                });
            }
        }

        var nextAiring = null;
        if (aniMedia && aniMedia.nextAiringEpisode) {
            var nxt = aniMedia.nextAiringEpisode;
            nextAiring = new NextAiring({
                episode: nxt.episode || 1,
                airingAt: nxt.airingAt || 0
            });
        }

        var syncData = {
            source: "allanime",
            allanimeId: show._id,
            malId: show.idMal || (aniMedia && aniMedia.idMal) || null,
            anilistId: aniMedia && aniMedia.id ? aniMedia.id : null
        };

        var item = new MultimediaItem({
            title: resolvedTitle,
            titles: aniMedia && aniMedia.titles || { display: resolvedTitle },
            alternativeTitles: aniMedia && aniMedia.alternativeTitles || uniqueStrings([show.englishName, show.name, show.nativeName]),
            url: url,
            posterUrl: poster,
            coverUrl: banner,
            type: (showType && showType.toLowerCase().indexOf("movie") !== -1) ? "movie" : "anime",
            format: (aniMedia && aniMedia.format) || showType || null,
            bannerUrl: banner,
            description: description ? description.substring(0, 5000) : "",
            background: aniMedia && aniMedia.raw && normalizeText(aniMedia.raw.background),
            year: year || (aniMedia && aniMedia.startDate && aniMedia.startDate.year) || 0,
            season: aniMedia && aniMedia.season || null,
            seasonYear: aniMedia && aniMedia.seasonYear || null,
            releaseDate: aniMedia && aniMedia.startDate ? normalizeDate([aniMedia.startDate.year, aniMedia.startDate.month, aniMedia.startDate.day].filter(Boolean).join("-")) : null,
            score: averageScore || 0,
            meanScore: aniMedia && aniMedia.meanScore || 0,
            popularity: aniMedia && aniMedia.popularity || null,
            duration: (aniMedia && aniMedia.duration) || null,
            episodeCount: totalEpisodes || null,
            status: status,
            tags: combinedTags,
            genres: combinedTags,
            studios: aniMedia && aniMedia.studios || [],
            contentRating: aniMedia && aniMedia.raw && (aniMedia.raw.ageRating || aniMedia.raw.contentRating) || null,
            cast: cast,
            recommendations: recommendations,
            trailer: trailer,
            nextAiring: nextAiring,
            syncData: syncData,
            episodes: allEpisodes,
            headers: HEADERS
        });

        setCached(cacheKey, item);
        log("load", "Loaded: " + resolvedTitle + " with " + allEpisodes.length + " episodes");
        return item;
    }

    async function _loadStreams(url) {
        log("streams", "Resolving streams for: " + String(url).substring(0, 80));

        var payload = parseSourceId(url);
        if (!payload || !payload.id) {
            throw new Error("MISSING_EPISODE_ID");
        }

        var source = (payload.source || "allanime").toLowerCase();
        var episode = String(payload.episode || "");
        var dubStatus = payload.dubStatus || "sub";
        var showId = payload.id;

        var cacheKey = "streams:" + source + ":" + showId + ":" + dubStatus + ":" + episode;
        if (wasRecentlyFailed(cacheKey)) {
            throw new Error("RECENTLY_FAILED");
        }

        // HiAnime has its own per-episode source endpoint. Jikan/Kitsu don't carry streams, so
        // they fall through to the Jikan-based AllAnime id resolution as a last resort.
        if (source === "hianime") {
            var hiSources = await _loadStreamsFromHiAnime(showId, episode, dubStatus);
            if (hiSources && hiSources.length) {
                setCached(cacheKey, hiSources);
                return hiSources;
            }
            setCachedFailure(cacheKey);
            throw new Error("NO_PLAYABLE_STREAMS");
        }

        if (source === "jikan" || source === "kitsu" || source === "anilist") {
            // Re-route MAL/AniList ids to AllAnime by title when possible.
            var routed = await _loadStreamsFromMetadataId(source, showId, episode, dubStatus);
            if (routed && routed.length) {
                setCached(cacheKey, routed);
                return routed;
            }
            setCachedFailure(cacheKey);
            throw new Error("NO_PLAYABLE_STREAMS");
        }

        var variables = {
            showId: showId,
            episodeString: episode,
            translationType: dubStatus
        };

        log("streams", "Querying server endpoint showId=" + showId + " episode=" + episode + " dub=" + dubStatus);

        // Two attempts: GET then POST. The third slot was a duplicate of the first and has
        // been removed — it added no recovery value and just doubled the load.
        var res = null;
        var attempts = [
            { method: "GET",  hash: HASHES.server },
            { method: "POST", hash: HASHES.server }
        ];

        for (var attemptIdx = 0; attemptIdx < attempts.length; attemptIdx++) {
            res = await safeQueryGraph(variables, attempts[attemptIdx].hash, attempts[attemptIdx].method);
            if (res && res.data && res.data.episode) break;

            // If the persisted hash is stale, re-issue as a raw text query.
            if (res && res.errors) {
                var errCode = res.errors[0] && res.errors[0].extensions && res.errors[0].extensions.code;
                if (errCode === "PERSISTED_QUERY_NOT_FOUND" || errCode === "AA_CRYPTO_MISSING") {
                    log("streams", "API error " + errCode + " — retrying as raw query");
                    try {
                        var directQuery = "query($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) { episode(showId: $showId, translationType: $translationType, episodeString: $episodeString) { episodeString sourceUrls subtitles } }";
                        var directBody = JSON.stringify({ query: directQuery, variables: variables });
                        var directRes = await http_post(getApiUrl(), HEADERS, directBody);
                        if (directRes && directRes.body) {
                            try {
                                var parsed = JSON.parse(directRes.body);
                                if (parsed && parsed.data && parsed.data.episode) {
                                    log("streams", "Direct query succeeded");
                                    res = parsed;
                                    break;
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
        }

        if (!res || !res.data || !res.data.episode) {
            if (res && res.errors) {
                logError("streams:graphql", JSON.stringify(res.errors).substring(0, 300));
            }
            setCachedFailure(cacheKey);
            throw new Error("NO_EPISODE_DATA");
        }

        var episodeData = res.data.episode;
        var sourceUrls = episodeData.sourceUrls;
        if (!sourceUrls || typeof sourceUrls !== "object") {
            setCachedFailure(cacheKey);
            throw new Error("NO_SOURCE_URLS");
        }

        log("streams", "Found source URLs, resolving...");

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

        var streamResults = await resolveSourceEntries(sourceUrls, subtitles);

        if (streamResults.length === 0) {
            setCachedFailure(cacheKey);
            throw new Error("NO_PLAYABLE_STREAMS");
        }

        setCached(cacheKey, streamResults);
        log("streams", "Returning " + streamResults.length + " streams");
        return streamResults;
    }

    async function _loadStreamsFromHiAnime(animeId, episode, dubStatus) {
        if (!getHiAnimeBase()) return [];
        var ep = await hiAnimeGet("/api/v2/episodes/" + encodeURIComponent(animeId));
        var epList = Array.isArray(ep) ? ep : (ep && (ep.episodes || ep.items)) || [];
        if (!epList.length) return [];
        var epNum = parseInt(episode, 10);
        var match = null;
        for (var i = 0; i < epList.length; i++) {
            var e = epList[i];
            if (!e) continue;
            if (Number(e.episodeNumber) === epNum || Number(e.number) === epNum) { match = e; break; }
        }
        if (!match && epList[epNum - 1]) match = epList[epNum - 1];
        if (!match) return [];

        var sources = await hiAnimeGet("/api/v2/sources?animeId=" + encodeURIComponent(animeId) + "&episodeId=" + encodeURIComponent(match.id || "") + "&type=" + encodeURIComponent(dubStatus));
        var sourceList = Array.isArray(sources) ? sources : (sources && (sources.sources || sources.items || sources.data)) || [];
        if (!sourceList.length) return [];

        var streamResults = [];
        for (var j = 0; j < sourceList.length; j++) {
            var s = sourceList[j];
            if (!s) continue;
            var streamUrl = s.url || s.link || s.file;
            if (!streamUrl) continue;
            if (isPlayableMediaUrl(streamUrl)) {
                streamResults.push(new StreamResult({
                    url: streamUrl,
                    source: "HiAnime / " + (s.server || s.name || s.source || "Direct"),
                    quality: qualityFromText(String(s.quality || "")) || "Auto",
                    headers: HEADERS,
                    subtitles: []
                }));
            } else {
                await resolveEmbeddedSource(streamUrl, "HiAnime / " + (s.server || s.name || s.source || "Embed"), [], streamResults, "https://hianime.to");
            }
        }
        return streamResults;
    }

    async function _loadStreamsFromMetadataId(source, id, episode, dubStatus) {
        // Resolve a MAL/AniList/Kitsu id to an AllAnime show id via AniList search.
        var media = null;
        if (source === "jikan") media = await getAniListMedia({ idMal: parseInt(id, 10) });
        else if (source === "anilist") media = await getAniListMedia({ id: parseInt(id, 10) });
        else if (source === "kitsu") {
            var kitsuDetail = await kitsuGet("/anime/" + encodeURIComponent(id));
            var kitsuAttrs = kitsuDetail && kitsuDetail.data && kitsuDetail.data.attributes;
            var kitsuTitle = kitsuAttrs && firstNonEmpty(kitsuAttrs.canonicalTitle, kitsuAttrs.titles && kitsuAttrs.titles.en, kitsuAttrs.titles && kitsuAttrs.titles.en_jp);
            if (kitsuTitle) media = await getAniListMedia({ search: kitsuTitle });
        }

        if (!media) return [];
        var title = (media.title && (media.title.english || media.title.romaji || media.title.userPreferred)) || "";
        if (!title) return [];

        var res = await safeQueryGraph({ search: { query: title }, limit: 10, page: 1, translationType: dubStatus === "dub" ? "dub" : "sub", countryOrigin: "ALL" }, HASHES.mainPage, "GET");
        var edges = (res && res.data && res.data.shows && res.data.shows.edges) || [];
        var pick = null;
        for (var i = 0; i < edges.length; i++) {
            if (edges[i] && edges[i]._id) { pick = edges[i]; break; }
        }
        if (!pick) return [];

        var variables = {
            showId: pick._id,
            episodeString: String(episode || "1"),
            translationType: dubStatus === "dub" ? "dub" : "sub"
        };
        var streamRes = await safeQueryGraph(variables, HASHES.server, "GET");
        if (!streamRes || !streamRes.data || !streamRes.data.episode) {
            streamRes = await safeQueryGraph(variables, HASHES.server, "POST");
        }
        if (!streamRes || !streamRes.data || !streamRes.data.episode) return [];
        return await resolveSourceEntries(streamRes.data.episode.sourceUrls, []);
    }

    // ============================================================================
    // EXPORTED ADAPTERS (cb-style for SkyStream host + skystream test)
    // ============================================================================

    async function getHome(cb) {
        try {
            var data = await _getHome();
            cb({ success: true, data: data });
        } catch (e) {
            logError("getHome", e);
            cb({
                success: false,
                errorCode: "GET_HOME_ERROR",
                message: logError("getHome", e)
            });
        }
    }

    async function search(query, cb) {
        try {
            var data = await _search(query);
            cb({ success: true, data: data });
        } catch (e) {
            logError("search", e);
            cb({
                success: false,
                errorCode: "SEARCH_ERROR",
                message: logError("search", e)
            });
        }
    }

    async function load(url, cb) {
        try {
            var data = await _load(url);
            cb({ success: true, data: data });
        } catch (e) {
            logError("load", e);
            cb({
                success: false,
                errorCode: "LOAD_ERROR",
                message: logError("load", e)
            });
        }
    }

    async function loadStreams(url, cb) {
        try {
            var data = await _loadStreams(url);
            cb({ success: true, data: data });
        } catch (e) {
            logError("loadStreams", e);
            cb({
                success: false,
                errorCode: "STREAM_ERROR",
                message: logError("loadStreams", e)
            });
        }
    }

    // Required by skystream-cli's validate command.
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
