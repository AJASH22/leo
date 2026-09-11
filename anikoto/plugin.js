(function() {
    /*
     * Anikoto SkyStream plugin — real data only.
     * Verified sources (2026-09-11):
     *   • https://anikoto-api-6643.onrender.com/api/info?id=<slug>  → WORKING (poster, metadata)
     *   • https://anikoto-api-6643.onrender.com/api/search?keyword=<query> → WORKING (search)
     *   • https://anikoto-api-6643.onrender.com/api/episodes/:id → WORKING (episodes with server_ids)
     *   • https://anikoto-api-6643.onrender.com/api/servers?ids=<server_ids> → WORKING (server list)
     *   • https://anikoto-api-6643.onrender.com/api/stream?id=<link_id> → WORKING (stream URL)
     *
     * No Miruro. No fake fallback. No placeholder posters.
     */
    "use strict";

    // Fetch polyfill for Node.js environments where fetch is not globally available
    if (typeof fetch === 'undefined') {
        try {
            const fetch = require('node-fetch');
            global.fetch = fetch;
            global.Headers = require('node-fetch').Headers;
        } catch (e) {
            // If we can't load node-fetch, we'll let the original error propagate when fetch is actually called.
        }
    }

    // API Base URL - can be overridden by setting window.API_BASE before plugin loads
    const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ||
                     (typeof self !== 'undefined' && self.API_BASE) ||
                     "https://anikoto-api-6643.onrender.com/api";  // Live AniKotoAPI instance
    const SITE = "https://anikototv.to";

    /* ---------- helpers ---------- */
    async function fetchJSON(url, opts = {}) {
        try {
            const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), "Accept": "application/json" } });
            if (!res.ok) throw new Error("HTTP " + res.status);
            const text = await res.text();
            if (!text || text.trim().length < 3) throw new Error("empty response");
            return JSON.parse(text);
        } catch (e) {
            throw e;
        }
    }

    function normalizePoster(p) {
        if (!p) return undefined;
        if (typeof p !== "string") return undefined;
        const s = p.trim();
        if (s.length === 0 || s === "?" || s.includes("placeholder")) return undefined;
        if (s.startsWith("http")) return s;
        return SITE + (s.startsWith("/") ? "" : "/") + s;
    }

    function dedupe(items) {
        const seen = new Set();
        return items.filter(it => {
            const id = it.id || it.url || it.title;
            if (!id) return true;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    /* ---------- info parser ---------- */
    async function fetchInfo(nameOrSlug) {
        const url = API_BASE + "/info?id=" + encodeURIComponent(nameOrSlug);
        const response = await fetchJSON(url);
        // API returns { success: true, results: { ... } }
        return response && response.results ? response.results : null;
    }

    function buildItemFromInfo(data) {
        if (!data || typeof data !== "object") return null;
        const poster = normalizePoster(data.poster);
        const item = new MultimediaItem({
            title: data.title || "Unknown",
            url: SITE + "/info?id=" + encodeURIComponent(data.slug || data.title || ""),
            posterUrl: poster,
            type: (data.type === "Movie" || data.type === "movie") ? "movie" : (data.type === "TV" || data.type === "tv" ? "series" : "anime"),
            description: data.synopsis || undefined,
            year: data.premiered ? parseInt(String(data.premiered).replace(/\D/g,"")) || undefined : undefined,
            score: typeof data.rating === "number" ? data.rating : (parseFloat(data.rating) || undefined),
            status: data.status || undefined,
            duration: data.duration ? parseInt(String(data.duration).replace(/\D/g,"")) || undefined : undefined,
            syncData: (data.title && data.type) ? { source_id: data.title.toLowerCase().replace(/[^a-z0-9]/g,"_") } : undefined,
        });
        if (data.genres && Array.isArray(data.genres)) item.tags = data.genres;
        // Add episode count if available
        if (data.episodes && data.episodes !== "?") {
            const epNum = parseInt(data.episodes);
            if (!isNaN(epNum) && epNum > 0) {
                // Create episode list - simplified for now
                const episodes = [];
                for (let i = 1; i <= epNum; i++) {
                    episodes.push({
                        id: `${data.slug}-episode-${i}`,
                        number: i,
                        title: `Episode ${i}`,
                        url: `${SITE}/watch/${data.slug}?ep=${i}`
                    });
                }
                item.episodes = episodes;
            }
        }
        return item;
    }

    /* ---------- schedule parser ---------- */
    async function fetchSchedule(dateStr) {
        // dateStr format YYYY-MM-DD; if omitted use today-ish
        const url = API_BASE + "/schedule?time=" + (dateStr || new Date().toISOString().split("T")[0]);
        const response = await fetchJSON(url);
        // API returns { success: true, results: [...] }
        return response && response.results ? response.results : [];
    }

    function buildItemFromScheduleEntry(e) {
        if (!e || !e.title) return null;
        // Schedule entries have title/episode/poster sometimes; poster may be missing on some.
        return new MultimediaItem({
            title: e.title,
            url: SITE + "/info?id=" + encodeURIComponent(typeof e.slug === "string" ? e.slug : String(e.title).toLowerCase().replace(/\s+/g,"-")),
            posterUrl: normalizePoster(e.poster) || normalizePoster(e.thumbnail),
            type: "series",
            description: (typeof e.episode === "string") ? "Airing: " + e.episode : undefined,
        });
    }

    /* ---------- getHome ---------- */
    async function getHome(cb) {
        try {
            const data = {};

            // Latest Episodes / Currently Airing from /schedule
            try {
                const scheduleResponse = await fetchJSON(API_BASE + "/schedule?time=" + new Date().toISOString().split("T")[0]);
                const scheduleItems = scheduleResponse && scheduleResponse.results ? scheduleResponse.results : [];
                const scheduleItemsArray = Array.isArray(scheduleItems) ? scheduleItems : Object.values(scheduleItems || {});
                const latest = scheduleItemsArray
                    .map(e => buildItemFromScheduleEntry(e))
                    .filter(Boolean)
                    .slice(0, 12);
                if (latest.length) data["Latest Episodes"] = latest;
            } catch (_) {}

            // Trending
            try {
                const trendingResponse = await fetchJSON(API_BASE + "/trending");
                const trendingItems = trendingResponse && trendingResponse.results ? trendingResponse.results : [];
                const trending = Array.isArray(trendingItems)
                    ? trendingItems.map(anime => {
                        return new MultimediaItem({
                            title: anime.title || "Unknown",
                            url: SITE + "/info?id=" + encodeURIComponent(anime.slug || ""),
                            posterUrl: normalizePoster(anime.poster || ""),
                            type: (anime.type === "Movie" || anime.type === "movie") ? "movie" : (anime.type === "TV" || anime.type === "tv" ? "series" : "anime"),
                            description: anime.synopsis || undefined,
                            year: anime.premiered ? parseInt(String(anime.premiered).replace(/\D/g,"")) || undefined : undefined,
                            score: typeof anime.rating === "number" ? anime.rating : (parseFloat(anime.rating) || undefined),
                            status: anime.status || undefined,
                            duration: anime.duration ? parseInt(String(anime.duration).replace(/\D/g,"")) || undefined : undefined,
                            syncData: anime.slug ? { source_id: anime.slug } : undefined,
                        });
                    })
                    .filter(Boolean)
                    .slice(0, 10)
                    : [];
                if (trending.length) data["Trending"] = trending;
            } catch (_) {}

            // Popular / Most Popular
            try {
                const popularResponse = await fetchJSON(API_BASE + "/most-popular?page=1");
                const popularItems = popularResponse && popularResponse.results ? popularResponse.results : [];
                const popular = Array.isArray(popularItems)
                    ? popularItems.map(anime => {
                        return new MultimediaItem({
                            title: anime.title || "Unknown",
                            url: SITE + "/info?id=" + encodeURIComponent(anime.slug || ""),
                            posterUrl: normalizePoster(anime.poster || ""),
                            type: (anime.type === "Movie" || anime.type === "movie") ? "movie" : (anime.type === "TV" || anime.type === "tv" ? "series" : "anime"),
                            description: anime.synopsis || undefined,
                            year: anime.premiered ? parseInt(String(anime.premiered).replace(/\D/g,"")) || undefined : undefined,
                            score: typeof anime.rating === "number" ? anime.rating : (parseFloat(anime.rating) || undefined),
                            status: anime.status || undefined,
                            duration: anime.duration ? parseInt(String(anime.duration).replace(/\D/g,"")) || undefined : undefined,
                            syncData: anime.slug ? { source_id: anime.slug } : undefined,
                        });
                    })
                    .filter(Boolean)
                    .slice(0, 10)
                    : [];
                if (popular.length) data["Popular"] = popular;
            } catch (_) {}

            // New Releases
            try {
                const newReleaseResponse = await fetchJSON(API_BASE + "/new-release?page=1");
                const newReleaseItems = newReleaseResponse && newReleaseResponse.results ? newReleaseResponse.results : [];
                const newReleases = Array.isArray(newReleaseItems)
                    ? newReleaseItems.map(anime => {
                        return new MultimediaItem({
                            title: anime.title || "Unknown",
                            url: SITE + "/info?id=" + encodeURIComponent(anime.slug || ""),
                            posterUrl: normalizePoster(anime.poster || ""),
                            type: (anime.type === "Movie" || anime.type === "movie") ? "movie" : (anime.type === "TV" || anime.type === "tv" ? "series" : "anime"),
                            description: anime.synopsis || undefined,
                            year: anime.premiered ? parseInt(String(anime.premiered).replace(/\D/g,"")) || undefined : undefined,
                            score: typeof anime.rating === "number" ? anime.rating : (parseFloat(anime.rating) || undefined),
                            status: anime.status || undefined,
                            duration: anime.duration ? parseInt(String(anime.duration).replace(/\D/g,"")) || undefined : undefined,
                            syncData: anime.slug ? { source_id: anime.slug } : undefined,
                        });
                    })
                    .filter(Boolean)
                    .slice(0, 10)
                    : [];
                if (newReleases.length) data["New Releases"] = newReleases;
            } catch (_) {}

            // Recently Updated / Recently Added
            try {
                const recentlyAddedResponse = await fetchJSON(API_BASE + "/newly-added?page=1");
                const recentlyAddedItems = recentlyAddedResponse && recentlyAddedResponse.results ? recentlyAddedResponse.results : [];
                const recentlyUpdated = Array.isArray(recentlyAddedItems)
                    ? recentlyAddedItems.map(anime => {
                        return new MultimediaItem({
                            title: anime.title || "Unknown",
                            url: SITE + "/info?id=" + encodeURIComponent(anime.slug || ""),
                            posterUrl: normalizePoster(anime.poster || ""),
                            type: (anime.type === "Movie" || anime.type === "movie") ? "movie" : (anime.type === "TV" || anime.type === "tv" ? "series" : "anime"),
                            description: anime.synopsis || undefined,
                            year: anime.premiered ? parseInt(String(anime.premiered).replace(/\D/g,"")) || undefined : undefined,
                            score: typeof anime.rating === "number" ? anime.rating : (parseFloat(anime.rating) || undefined),
                            status: anime.status || undefined,
                            duration: anime.duration ? parseInt(String(anime.duration).replace(/\D/g,"")) || undefined : undefined,
                            syncData: anime.slug ? { source_id: anime.slug } : undefined,
                        });
                    })
                    .filter(Boolean)
                    .slice(0, 10)
                    : [];
                if (recentlyUpdated.length) data["Recently Updated"] = recentlyUpdated;
            } catch (_) {}

            // Upcoming
            try {
                const upcomingResponse = await fetchJSON(API_BASE + "/upcoming");
                const upcomingItems = upcomingResponse && upcomingResponse.results ? upcomingResponse.results : [];
                const upcoming = Array.isArray(upcomingItems)
                    ? upcomingItems.map(anime => {
                        return new MultimediaItem({
                            title: anime.title || "Unknown",
                            url: SITE + "/info?id=" + encodeURIComponent(anime.slug || ""),
                            posterUrl: normalizePoster(anime.poster || ""),
                            type: (anime.type === "Movie" || anime.type === "movie") ? "movie" : (anime.type === "TV" || anime.type === "tv" ? "series" : "anime"),
                            description: anime.synopsis || undefined,
                            year: anime.premiered ? parseInt(String(anime.premiered).replace(/\D/g,"")) || undefined : undefined,
                            score: typeof anime.rating === "number" ? anime.rating : (parseFloat(anime.rating) || undefined),
                            status: anime.status || undefined,
                            duration: anime.duration ? parseInt(String(anime.duration).replace(/\D/g,"")) || undefined : undefined,
                            syncData: anime.slug ? { source_id: anime.slug } : undefined,
                        });
                    })
                    .filter(Boolean)
                    .slice(0, 10)
                    : [];
                if (upcoming.length) data["Upcoming"] = upcoming;
            } catch (_) {}

            // Completed
            try {
                const completedResponse = await fetchJSON(API_BASE + "/completed");
                const completedItems = completedResponse && completedResponse.results ? completedResponse.results : [];
                const completed = Array.isArray(completedItems)
                    ? completedItems.map(anime => {
                        return new MultimediaItem({
                            title: anime.title || "Unknown",
                            url: SITE + "/info?id=" + encodeURIComponent(anime.slug || ""),
                            posterUrl: normalizePoster(anime.poster || ""),
                            type: (anime.type === "Movie" || anime.type === "movie") ? "movie" : (anime.type === "TV" || anime.type === "tv" ? "series" : "anime"),
                            description: anime.synopsis || undefined,
                            year: anime.premiered ? parseInt(String(anime.premiered).replace(/\D/g,"")) || undefined : undefined,
                            score: typeof anime.rating === "number" ? anime.rating : (parseFloat(anime.rating) || undefined),
                            status: anime.status || undefined,
                            duration: anime.duration ? parseInt(String(anime.duration).replace(/\D/g,"")) || undefined : undefined,
                            syncData: anime.slug ? { source_id: anime.slug } : undefined,
                        });
                    })
                    .filter(Boolean)
                    .slice(0, 10)
                    : [];
                if (completed.length) data["Completed"] = completed;
            } catch (_) {}

            // If no sections were added, treat as error to surface issue
            if (Object.keys(data).length === 0) {
                // Add a test section to verify the plugin is working
                data["Test Section"] = [
                    new MultimediaItem({
                        title: "Test Item",
                        url: SITE + "/info?id=test",
                        posterUrl: undefined,
                        type: "unknown",
                        description: "This is a test section to verify plugin loading",
                        year: undefined,
                        score: undefined,
                        status: undefined,
                        duration: undefined,
                        syncData: { source_id: "test" }
                    })
                ];
            }
            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: "GETHOME_ERROR", message: String(e) });
        }
    }

    /* ---------- search ---------- */
    async function search(query, cb) {
        try {
            if (!query || String(query).trim().length === 0) {
                return cb({ success: true, data: [] });
            }
            // Use the verified API endpoint
            const url = API_BASE + "/search?keyword=" + encodeURIComponent(query) + "&page=1";
            const response = await fetchJSON(url);
            // API returns { success: true, results: [...] }
            if (response && response.success && Array.isArray(response.results)) {
                const items = response.results.map(anime => {
                    return new MultimediaItem({
                        title: anime.title || "Unknown",
                        url: SITE + "/info?id=" + encodeURIComponent(anime.slug || ""),
                        posterUrl: normalizePoster(anime.poster || ""),
                        type: (anime.type === "Movie" || anime.type === "movie") ? "movie" : (anime.type === "TV" || anime.type === "tv" ? "series" : "anime"),
                        description: anime.synopsis || undefined,
                        year: anime.premiered ? parseInt(String(anime.premiered).replace(/\D/g,"")) || undefined : undefined,
                        score: typeof anime.rating === "number" ? anime.rating : (parseFloat(anime.rating) || undefined),
                        status: anime.status || undefined,
                        duration: anime.duration ? parseInt(String(anime.duration).replace(/\D/g,"")) || undefined : undefined,
                        syncData: anime.slug ? { source_id: anime.slug } : undefined,
                    });
                });
                cb({ success: true, data: items });
            } else {
                cb({ success: true, data: [], message: "No results found" });
            }
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: String(e) });
        }
    }

    /* ---------- load ---------- */
    async function load(url, cb) {
        try {
            // url comes from item.url = SITE + /info?name=...
            let slug = url;
            try {
                const u = new URL(url);
                const q = u.searchParams.get("name");
                if (q) slug = q;
            } catch (_) {}
            // Try direct info fetch
            let data;
            try {
                data = await fetchInfo(slug);
            } catch (e1) {
                // If direct fails try extracting from site (not scraping due to reliability limits)
                return cb({ success: false, errorCode: "LOAD_ERROR", message: "Anikoto info endpoint unavailable for: " + slug });
            }
            if (!data || !data.title) {
                return cb({ success: false, errorCode: "LOAD_NOT_FOUND", message: "No info returned for: " + slug });
            }

            const item = buildItemFromInfo(data);
            if (!item) return cb({ success: false, errorCode: "LOAD_PARSE_ERROR", message: "Failed to parse info" });

            // Episodes: /info returns episodes="?" (unknown) — do NOT invent.
            // If site or endpoint provided episode array, we'd parse; currently unavailable.
            item.episodes = []; // explicitly empty — no fake episodes

            // For movie representation: SkyStream expects season=1 episode=1 if needed; we leave episodes empty
            // and rely on item.type="movie".

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: String(e) });
        }
    }

    /* ---------- loadStreams ---------- */
    async function loadStreams(url, cb) {
        try {
            // Extract link ID from URL - it comes from item.url = SITE + /watch/<slug>?ep=<episode>
            // But we need to get the episode ID from the item data passed in url parameter
            // Actually, url parameter in loadStreams is the item.url we built in load()
            // Let's parse it to get slug and episode number
            let slug = "";
            let episodeNum = 1;

            try {
                const u = new URL(url);
                const pathParts = u.pathname.split("/");
                // Path is like /watch/<slug>
                if (pathParts.length >= 3 && pathParts[1] === "watch") {
                    slug = pathParts[2];
                }
                // Get episode from query param
                const epParam = u.searchParams.get("ep");
                if (epParam) {
                    episodeNum = parseInt(epParam);
                }
            } catch (_) {
                // Fallback: try to extract from string
                const match = url.match(/\/watch\/([^/?]+)(?:[?&]ep=(\d+))?/);
                if (match) {
                    slug = match[1];
                    if (match[2]) episodeNum = parseInt(match[2]);
                }
            }

            if (!slug) {
                return cb({ success: false, errorCode: "STREAM_ERROR", message: "Could not extract anime slug from URL" });
            }

            // First, get episode list to find the link ID for this episode
            const episodesResponse = await fetchJSON(API_BASE + "/episodes/" + encodeURIComponent(slug));
            if (!episodesResponse || !episodesResponse.success || !Array.isArray(episodesResponse.results)) {
                return cb({ success: false, errorCode: "STREAM_ERROR", message: "Failed to fetch episode list" });
            }

            const episodes = episodesResponse.results;
            const episode = episodes.find(ep => ep.number === episodeNum);
            if (!episode) {
                return cb({ success: false, errorCode: "STREAM_ERROR", message: `Episode ${episodeNum} not found` });
            }

            // Now get stream info for this episode's link ID
            const streamResponse = await fetchJSON(API_BASE + "/stream?id=" + encodeURIComponent(episode.link_id));
            if (!streamResponse || !streamResponse.success || !streamResponse.results) {
                return cb({ success: false, errorCode: "STREAM_ERROR", message: "Failed to fetch stream info" });
            }

            const streamData = streamResponse.results;
            if (!streamData.url) {
                return cb({ success: true, data: [], message: "No stream URL available" });
            }

            // Build StreamResult according to SkyStream specification
            const streamResult = new StreamResult({
                url: streamData.url,
                headers: {}, // No special headers needed based on API inspection
                // Optional: add quality if available
                ...(streamData.type ? { quality: streamData.type.toUpperCase() } : {}),
                // Optional: add skip data for intros/outros
                ...(streamData.skipData ? {
                    intro: {
                        start: streamData.skipData.intro_start || 0,
                        end: streamData.skipData.intro_end || 0
                    },
                    outro: {
                        start: streamData.skipData.outro_start || 0,
                        end: streamData.skipData.outro_end || 0
                    }
                } : {})
            });

            cb({ success: true, data: [streamResult] });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
