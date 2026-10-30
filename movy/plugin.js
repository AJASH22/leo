(function () {
    const BASE = "https://www.movy.sx";

    function absolute(path) {
        if (!path) return "";
        try {
            return new URL(path, BASE).href;
        } catch (_) {
            return "";
        }
    }

    async function getPageData(url) {
        const response = await http_get(url, {
            Accept: "text/html",
            "User-Agent": "Mozilla/5.0"
        });

        if (!response || response.status !== 200) {
            throw new Error(
                "Movy returned HTTP " + (response?.status ?? "no response")
            );
        }

        const html = response.body || response;
        const match = String(html).match(
            /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
        );

        if (!match) {
            throw new Error("Movy page did not contain its public catalog data");
        }

        return JSON.parse(match[1]);
    }

    function collectItems(data) {
        const props = data?.props?.pageProps || {};
        const sections = {};

        function addSection(name, items) {
            if (!Array.isArray(items)) return;

            const mapped = items
                .filter(item => item && item.title && item.slug)
                .map(item => ({
                    raw: item,
                    title: item.title,
                    url: absolute(item.slug),
                    posterUrl: absolute(item.poster || item.image),
                    bannerUrl: absolute(item.image || item.background),
                    description: item.description || "",
                    type: item.mediaType === "tv" ? "series" : "movie",
                    year: Number.parseInt(
                        String(item.release_date || "").slice(0, 4), 10
                    ) || undefined,
                    score: Number(item.rating) || undefined
                }));

            if (mapped.length) sections[name] = mapped;
        }

        for (const section of props.trendingSections || []) {
            addSection(section.name || "Trending", section.movies);
        }

        for (const section of props.defaultSections || []) {
            addSection(section.name || "Featured", section.movies);
        }

        for (const section of props.streamingSections || []) {
            addSection(section.name || "Streaming", section.movies);
        }

        addSection("Upcoming TV", props.upcomingTv);
        addSection("Recent 4K", props.recent4k);

        return sections;
    }

    function toItem(item) {
        return new MultimediaItem({
            title: item.title,
            url: item.url,
            posterUrl: item.posterUrl,
            bannerUrl: item.bannerUrl,
            type: item.type,
            description: item.description,
            year: item.year,
            score: item.score,
            headers: { Referer: BASE }
        });
    }

    async function getHome(cb) {
        try {
            const data = await getPageData(BASE + "/");
            const sections = collectItems(data);
            const result = {};

            for (const [name, items] of Object.entries(sections)) {
                result[name] = items.map(toItem);
            }

            if (!Object.keys(result).length) {
                throw new Error("No catalog sections were found on Movy's homepage");
            }

            cb({ success: true, data: result });
        } catch (e) {
            cb({
                success: false,
                errorCode: "PARSE_ERROR",
                message: String(e?.message || e)
            });
        }
    }

    async function search(query, cb) {
        try {
            const term = String(query || "").trim().toLocaleLowerCase();

            if (!term) {
                cb({ success: true, data: [] });
                return;
            }

            const data = await getPageData(BASE + "/");
            const sections = collectItems(data);
            const unique = new Map();

            for (const items of Object.values(sections)) {
                for (const item of items) {
                    if (item.title.toLocaleLowerCase().includes(term)) {
                        unique.set(item.url, item);
                    }
                }
            }

            cb({ success: true, data: [...unique.values()].map(toItem) });
        } catch (e) {
            cb({
                success: false,
                errorCode: "SEARCH_ERROR",
                message: String(e?.message || e)
            });
        }
    }

    async function load(url, cb) {
        try {
            const target = absolute(url);

            if (!target || !target.startsWith(BASE + "/")) {
                throw new Error("Invalid Movy catalog URL");
            }

            const data = await getPageData(target);
            const sections = collectItems(data);
            let found = null;

            for (const items of Object.values(sections)) {
                found = items.find(item => item.url === target);
                if (found) break;
            }

            const props = data?.props?.pageProps || {};
            const candidates = [
                props.movie,
                props.show,
                props.media,
                props.item,
                props.details
            ].filter(Boolean);

            if (!found) {
                const item = candidates.find(x => x.title || x.name);
                if (item) {
                    found = {
                        title: item.title || item.name,
                        url: target,
                        posterUrl: absolute(item.poster || item.image),
                        bannerUrl: absolute(item.background || item.image),
                        description: item.description || "",
                        type: item.mediaType === "tv" || item.type === "tv"
                            ? "series" : "movie",
                        year: Number.parseInt(
                            String(item.release_date || "").slice(0, 4), 10
                        ) || undefined,
                        score: Number(item.rating) || undefined
                    };
                }
            }

            if (!found) {
                throw new Error(
                    "Movy did not expose matching detail metadata in its public page data"
                );
            }

            cb({ success: true, data: toItem(found) });
        } catch (e) {
            cb({
                success: false,
                errorCode: "LOAD_ERROR",
                message: String(e?.message || e)
            });
        }
    }

    async function loadStreams(url, cb) {
        // Do not return a sample video or invent a playable URL.
        cb({ success: true, data: [] });
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
