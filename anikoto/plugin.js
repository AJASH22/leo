(function() {
    /*
     * Anikoto SkyStream plugin — real data only.
     * Verified sources (2026-09-10):
     *   • https://anikoto-api.onrender.com/info?name=<slug>  → WORKING (poster, metadata)
     *   • https://anikoto-api.onrender.com/schedule?time=YYYY-MM-DD → WORKING (airing list)
     *   • https://anikototvapi.vercel.app               → DEAD (404 DEPLOYMENT_NOT_FOUND)
     *   • /search, /episodes, /home (render mirror)    → BROKEN/empty
     *
     * No Miruro. No fake fallback. No placeholder posters.
     */
    "use strict";

    const API_BASE = "https://anikoto-api.onrender.com";
    const SITE = "https://anikototv.to";

    /* ---------- helpers ---------- */
    async function fetchJSON(url, opts = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
            const res = await fetch(url, { ...opts, signal: controller.signal, headers: { ...(opts.headers || {}), "Accept": "application/json" } });
            clearTimeout(timer);
            if (!res.ok) throw new Error("HTTP " + res.status);
            const text = await res.text();
            if (!text || text.trim().length < 3) throw new Error("empty response");
            return JSON.parse(text);
        } catch (e) {
            clearTimeout(timer);
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
        const url = API_BASE + "/info?name=" + encodeURIComponent(nameOrSlug);
        return await fetchJSON(url);
    }

    function buildItemFromInfo(data) {
        if (!data || typeof data !== "object") return null;
        const poster = normalizePoster(data.poster);
        const item = new MultimediaItem({
            title: data.title || "Unknown",
            url: SITE + "/info?name=" + encodeURIComponent(data.title || ""),
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
        return item;
    }

    /* ---------- schedule parser ---------- */
    async function fetchSchedule(dateStr) {
        // dateStr format YYYY-MM-DD; if omitted use today-ish
        const url = API_BASE + "/schedule?time=" + (dateStr || new Date().toISOString().split("T")[0]);
        return await fetchJSON(url);
    }

    function buildItemFromScheduleEntry(e) {
        if (!e || !e.title) return null;
        // Schedule entries have title/episode/poster sometimes; poster may be missing on some.
        return new MultimediaItem({
            title: e.title,
            url: SITE + "/info?name=" + encodeURIComponent(typeof e.slug === "string" ? e.slug : String(e.title).toLowerCase().replace(/\s+/g,"-")),
            posterUrl: normalizePoster(e.poster) || normalizePoster(e.thumbnail),
            type: "series",
            description: (typeof e.episode === "string") ? "Airing: " + e.episode : undefined,
        });
    }

    /* ---------- getHome ---------- */
    async function getHome(cb) {
        try {
            // Use /schedule for "Latest Episodes / Currently Airing"
            let scheduleRaw;
            try { scheduleRaw = await fetchSchedule(); } catch (_) { scheduleRaw = {}; }
            const scheduleItems = [];
            if (scheduleRaw && typeof scheduleRaw === "object") {
                // render mirror returns object with numeric keys
                Object.values(scheduleRaw).forEach(e => {
                    const it = buildItemFromScheduleEntry(e);
                    if (it) scheduleItems.push(it);
                });
            }
            const latest = dedupe(scheduleItems).slice(0, 12);

            // Use real /info for a known popular title (One Piece) as a representative "Popular / Trending"
            let popular = [];
            try {
                const op = await fetchInfo("one-piece-odmau");
                if (op && op.title) {
                    const it = buildItemFromInfo(op);
                    if (it) popular.push(it);
                }
            } catch (_) {}

            // Add a second known completed series if info works (e.g., farming-life...)
            try {
                const fl = await fetchInfo("farming-life-in-another-world-season-2-nisvn");
                if (fl && fl.title) { const it = buildItemFromInfo(fl); if (it) popular.push(it); }
            } catch (_) {}
            const popularD = dedupe(popular).slice(0, 6);

            const data = {};
            if (latest.length) data["Latest Episodes"] = latest;
            if (popularD.length) data["Popular"] = popularD;
            // Only add Trending if we have data — don't fabricate
            if (popularD.length >= 1) data["Trending"] = popularD.slice(0, 3);

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
            // Verified /search broken on both sources.
            // No reliable public search endpoint exists today.
            // Fail gracefully — do NOT fabricate results.
            cb({
                success: true,
                data: [],
                message: "Search endpoint currently unavailable on Anikoto source. Try loading a known title via info.",
            });
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
            // No verified stream endpoint (vercel dead; render has no /stream or /watch verified).
            // Do NOT invent mux.dev or any URL.
            cb({
                success: true,
                data: [],
                message: "Stream sources not currently exposed by verified Anikoto endpoint.",
            });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
