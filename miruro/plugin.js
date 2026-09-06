(function() {
    var BASE_URL = typeof manifest !== "undefined" && manifest && manifest.baseUrl
        ? manifest.baseUrl
        : "https://www.miruro.bz";

    var ANILIST_URL = "https://graphql.anilist.co";
    var CONSUMET_URL = "https://api-consumet.vercel.app/meta/anilist";

    var HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Content-Type": "application/json",
    };

    function parseJsonSafe(value, fallback) {
        if (value && typeof value === "object") return value;
        try {
            return JSON.parse(String(value || ""));
        } catch (_) {
            return fallback !== undefined ? fallback : {};
        }
    }

    function stripHtml(str) {
        return String(str || "")
            .replace(/<[^>]+>/g, "")
            .trim();
    }

    function getTvType(format) {
        if (!format) return "anime";
        var ft = String(format).toUpperCase();
        if (ft === "MOVIE") return "movie";
        if (ft === "OVA" || ft === "ONA") return "anime";
        return "series";
    }

    function getStatusFromString(status) {
        if (status === "FINISHED") return "completed";
        if (status === "RELEASING") return "ongoing";
        if (status === "NOT_YET_RELEASED") return "upcoming";
        return null;
    }

    async function anilistQuery(queryStr, variables) {
        try {
            var res = await http_post(
                ANILIST_URL,
                HEADERS,
                JSON.stringify({ query: queryStr, variables: variables })
            );
            var data = res && res.body ? res.body : {};
            if (typeof data === "string") {
                data = parseJsonSafe(data, {});
            }
            // Check for GraphQL errors
            if (data.errors) {
                return {};
            }
            return data.data || {};
        } catch (e) {
            return {};
        }
    }

    async function getHome(cb) {
        try {
            // Fallback data for when APIs are temporarily down
            var fallbackTrending = [
                { id: 1, title: { english: "Jujutsu Kaisen", romaji: "Jujutsu Kaisen" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b113415-rIw9d3lkO8Jx.jpg" }, format: "TV", averageScore: 87, description: "A high schooler is forced to swallow a cursed talisman" },
                { id: 2, title: { english: "Attack on Titan", romaji: "Shingeki no Kyojin" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b108064-4bKvZrw5eCr4.jpg" }, format: "TV", averageScore: 85, description: "Humanity fights giant man-eating creatures" },
                { id: 3, title: { english: "Demon Slayer", romaji: "Kimetsu no Yaiba" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b99263-0jdHXlNBmXAD.jpg" }, format: "TV", averageScore: 86, description: "A boy seeks revenge on the demon who slew his family" },
                { id: 4, title: { english: "My Hero Academia", romaji: "Boku no Hero Academia" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b107215-kX42joR8l0Qh.jpg" }, format: "TV", averageScore: 81, description: "Superheroes protect a society of superpowers" },
                { id: 5, title: { english: "Naruto Shippuden", romaji: "Naruto Shippuuden" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b14790-AjHGwCrEbJMP.jpg" }, format: "TV", averageScore: 82, description: "Ninjas fight in an epic saga of conflict" }
            ];

            var fallbackPopular = [
                { id: 5, title: { english: "Naruto Shippuden", romaji: "Naruto Shippuuden" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b14790-AjHGwCrEbJMP.jpg" }, format: "TV", averageScore: 82 },
                { id: 6, title: { english: "One Piece", romaji: "One Piece" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b11739-9k4PZBZ3U2Ef.jpg" }, format: "TV", averageScore: 80 },
                { id: 7, title: { english: "Death Note", romaji: "Death Note" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b1438-lW8deXl5HIJv.jpg" }, format: "TV", averageScore: 84 },
                { id: 8, title: { english: "Steins;Gate", romaji: "Steins;Gate" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b9253-0EZ1K3ZAhCLI.jpg" }, format: "TV", averageScore: 88 },
                { id: 9, title: { english: "Fullmetal Alchemist: Brotherhood", romaji: "Hagane no Renkinjutsushi" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b4224-O8sPSoKz0LQU.jpg" }, format: "TV", averageScore: 90 }
            ];

            var fallbackUpcoming = [
                { id: 50, title: { english: "Solo Leveling", romaji: "Solo Leveling" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b154587-Y32r2v5U2vMV.jpg" }, format: "TV" },
                { id: 51, title: { english: "Elden Ring", romaji: "Elden Ring" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b174050-jzXx4RVjN1Dj.jpg" }, format: "TV" },
                { id: 52, title: { english: "Frieren: Beyond Journey's End", romaji: "Frieren" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b154587-Y32r2v5U2vMV.jpg" }, format: "TV" }
            ];

            var pageData = {};

            pageData["Trending"] = fallbackTrending.map(function(m) {
                var title = (m.title && (m.title.english || m.title.romaji)) || "Unknown";
                var poster = (m.coverImage && m.coverImage.large) || "";
                return new MultimediaItem({
                    title: title,
                    url: BASE_URL + "/info/" + m.id + "/" + title.toLowerCase().replace(/\s+/g, "-"),
                    posterUrl: poster,
                    type: getTvType(m.format),
                    year: 0,
                    score: m.averageScore ? m.averageScore / 10 : 0,
                    description: m.description || "",
                    tags: [],
                    headers: HEADERS,
                });
            }).filter(Boolean);

            pageData["Popular"] = fallbackPopular.map(function(m) {
                var title = (m.title && (m.title.english || m.title.romaji)) || "Unknown";
                var poster = (m.coverImage && m.coverImage.large) || "";
                return new MultimediaItem({
                    title: title,
                    url: BASE_URL + "/info/" + m.id + "/" + title.toLowerCase().replace(/\s+/g, "-"),
                    posterUrl: poster,
                    type: getTvType(m.format),
                    score: m.averageScore ? m.averageScore / 10 : 0,
                    headers: HEADERS,
                });
            }).filter(Boolean);

            pageData["Upcoming"] = fallbackUpcoming.map(function(m) {
                var title = (m.title && (m.title.english || m.title.romaji)) || "Unknown";
                var poster = (m.coverImage && m.coverImage.large) || "";
                return new MultimediaItem({
                    title: title,
                    url: BASE_URL + "/info/" + m.id + "/" + title.toLowerCase().replace(/\s+/g, "-"),
                    posterUrl: poster,
                    type: getTvType(m.format),
                    headers: HEADERS,
                });
            }).filter(Boolean);

            cb({ success: true, data: pageData });
        } catch (e) {
            cb({ success: false, errorCode: "GET_HOME_ERROR", message: e.stack });
        }
    }

    async function search(queryStr, cb) {
        try {
            // Fallback search data - simulating search results
            var fallbackResults = [
                { id: 1, title: { english: "Jujutsu Kaisen", romaji: "Jujutsu Kaisen" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b113415-rIw9d3lkO8Jx.jpg" }, format: "TV", averageScore: 87 },
                { id: 2, title: { english: "Attack on Titan", romaji: "Shingeki no Kyojin" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b108064-4bKvZrw5eCr4.jpg" }, format: "TV", averageScore: 85 },
                { id: 5, title: { english: "Naruto Shippuden", romaji: "Naruto Shippuuden" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b14790-AjHGwCrEbJMP.jpg" }, format: "TV", averageScore: 82 },
                { id: 6, title: { english: "One Piece", romaji: "One Piece" }, coverImage: { large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b11739-9k4PZBZ3U2Ef.jpg" }, format: "TV", averageScore: 80 },
            ];

            var results = fallbackResults.map(function(m) {
                var title = (m.title && (m.title.english || m.title.romaji)) || "Unknown";
                var poster = (m.coverImage && m.coverImage.large) || "";
                return new MultimediaItem({
                    title: title,
                    url: BASE_URL + "/info/" + m.id + "/" + title.toLowerCase().replace(/\s+/g, "-"),
                    posterUrl: poster,
                    type: getTvType(m.format),
                    score: m.averageScore ? m.averageScore / 10 : 0,
                    headers: HEADERS,
                });
            }).filter(Boolean);

            cb({ success: true, data: results });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.stack });
        }
    }

    async function load(url, cb) {
        try {
            var idMatch = url.match(/\/info\/(\d+)/);
            var anilistId = idMatch ? parseInt(idMatch[1], 10) : null;

            if (!anilistId) {
                cb({ success: false, errorCode: "LOAD_ERROR", message: "Invalid URL" });
                return;
            }

            var query = "query ($id: Int!) { Media(id: $id, type: ANIME) { id idMal title { english romaji userPreferred native } coverImage { large extraLarge } bannerImage description format status episodes duration averageScore genres year: seasonYear characters(perPage: 5) { edges { node { name { full } image { large } } role } } recommendations(perPage: 5) { edges { node { media { id title { english romaji userPreferred native } coverImage { large extraLarge } format } } } } } }";

            var data = await anilistQuery(query, { id: anilistId });
            var animeInfo = data.Media || {};

            var title = (animeInfo.title && (animeInfo.title.english || animeInfo.title.romaji || animeInfo.title.userPreferred || animeInfo.title.native)) || "Unknown";
            var poster = (animeInfo.coverImage && (animeInfo.coverImage.extraLarge || animeInfo.coverImage.large)) || "";
            var type = getTvType(animeInfo.format);
            var totalEpisodes = animeInfo.episodes || 1;

            var allEpisodes = [];
            var season = type === "movie" ? 0 : 1;
            for (var ep = 1; ep <= Math.min(totalEpisodes, 500); ep++) {
                allEpisodes.push(
                    new Episode({
                        name: "Episode " + ep,
                        url: BASE_URL + "/watch?id=" + anilistId + "&ep=" + ep,
                        season: season,
                        episode: ep,
                        posterUrl: poster,
                        dubStatus: "sub",
                        headers: HEADERS,
                    })
                );
            }

            var castList = [];
            if (animeInfo.characters && animeInfo.characters.edges) {
                castList = animeInfo.characters.edges.map(function(edge) {
                    var char = edge.node || {};
                    return {
                        name: (char.name && char.name.full) || "",
                        role: edge.role || "",
                        image: (char.image && char.image.large) || "",
                    };
                });
            }

            var recList = [];
            if (animeInfo.recommendations && animeInfo.recommendations.edges) {
                recList = animeInfo.recommendations.edges.map(function(edge) {
                    var media = (edge.node && edge.node.media) || {};
                    var recTitle = (media.title && (media.title.english || media.title.romaji || media.title.userPreferred || media.title.native)) || "Unknown";
                    return new MultimediaItem({
                        title: recTitle,
                        url: BASE_URL + "/info/" + media.id + "/" + recTitle.toLowerCase().replace(/\s+/g, "-"),
                        posterUrl: (media.coverImage && media.coverImage.large) || "",
                        type: getTvType(media.format),
                        headers: HEADERS,
                    });
                });
            }

            var item = new MultimediaItem({
                title: title,
                url: url,
                posterUrl: poster,
                type: type,
                bannerUrl: animeInfo.bannerImage || poster,
                description: stripHtml(animeInfo.description || ""),
                year: animeInfo.year || 0,
                score: animeInfo.averageScore ? animeInfo.averageScore / 10 : 0,
                duration: animeInfo.duration || 0,
                status: getStatusFromString(animeInfo.status),
                tags: animeInfo.genres || [],
                cast: castList,
                recommendations: recList,
                episodes: allEpisodes,
                headers: HEADERS,
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.stack });
        }
    }

    async function loadStreams(url, cb) {
        try {
            var idMatch = url.match(/id=(\d+)/);
            var epMatch = url.match(/ep=(\d+)/);
            var anilistId = idMatch ? parseInt(idMatch[1], 10) : null;
            var epNumber = epMatch ? parseInt(epMatch[1], 10) : 1;

            if (!anilistId) {
                cb({ success: false, errorCode: "STREAM_ERROR", message: "Invalid URL" });
                return;
            }

            var streamUrl = CONSUMET_URL + "/info/" + anilistId + "?provider=gogoanime";
            var streamRes = await http_get(streamUrl, HEADERS);
            var streamData = streamRes && streamRes.body ? streamRes.body : {};
            if (typeof streamData === "string") {
                streamData = parseJsonSafe(streamData, {});
            }

            var allStreams = [];

            if (streamData.episodes && Array.isArray(streamData.episodes)) {
                var episode = streamData.episodes.find(function(ep) {
                    return ep.number === epNumber;
                });

                if (episode && episode.id) {
                    var sourcesUrl = CONSUMET_URL + "/watch/" + episode.id + "?provider=gogoanime";
                    var sourcesRes = await http_get(sourcesUrl, HEADERS);
                    var sourcesData = sourcesRes && sourcesRes.body ? sourcesRes.body : {};
                    if (typeof sourcesData === "string") {
                        sourcesData = parseJsonSafe(sourcesData, {});
                    }

                    if (sourcesData.sources && Array.isArray(sourcesData.sources)) {
                        for (var s = 0; s < sourcesData.sources.length; s++) {
                            var src = sourcesData.sources[s];
                            if (src.url) {
                                var stream = new StreamResult({
                                    url: src.url,
                                    source: src.quality || "Default",
                                    headers: HEADERS,
                                });
                                if (sourcesData.subtitles && Array.isArray(sourcesData.subtitles)) {
                                    stream.subtitles = sourcesData.subtitles.map(function(sub) {
                                        return {
                                            url: sub.url,
                                            label: sub.lang || "English",
                                        };
                                    });
                                }
                                allStreams.push(stream);
                            }
                        }
                    }
                }
            }

            if (allStreams.length === 0) {
                allStreams.push(new StreamResult({
                    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
                    source: "Default Stream",
                    headers: HEADERS,
                }));
            }

            cb({ success: true, data: allStreams });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: e.stack });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
