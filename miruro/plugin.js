(function() {
    // ============================================================================
    // CONFIGURATION
    // ============================================================================

    var BASE_URL = typeof manifest !== "undefined" && manifest && manifest.baseUrl
        ? manifest.baseUrl
        : "https://www.miruro.bz";

    var HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    };

    var PLUGIN_VERSION = 2;
    var CATALOG_VERSION = 2;

    // ============================================================================
    // MOCK DATA - for testing and fallback
    // ============================================================================

    var MOCK_ANIME = {
        trending: [
            { id: 1, title: "Jujutsu Kaisen", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b113415-rIw9d3lkO8Jx.jpg", banner: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-YmF4VGp0OTNwWk5m.jpg", format: "TV", status: "RELEASING", episodes: 24, averageScore: 87, description: "A high schooler encounters a cursed talisman and becomes the host of a powerful demon.", genres: ["Action", "Supernatural", "School"], year: 2020 },
            { id: 2, title: "Attack on Titan", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b108064-4bKvZrw5eCr4.jpg", banner: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/108064-dZM2mCDQXg0w.jpg", format: "TV", status: "FINISHED", episodes: 139, averageScore: 85, description: "Humanity fights for survival against giant man-eating creatures.", genres: ["Action", "Drama", "Fantasy"], year: 2013 },
            { id: 3, title: "Demon Slayer", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b99263-0jdHXlNBmXAD.jpg", banner: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/99263-AXkQ8yxqBFgw.jpg", format: "TV", status: "RELEASING", episodes: 55, averageScore: 86, description: "A boy seeks revenge on the demon who slew his family.", genres: ["Action", "Supernatural", "Adventure"], year: 2019 },
            { id: 4, title: "My Hero Academia", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b107215-kX42joR8l0Qh.jpg", banner: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/107215-XD0w2l0kq.jpg", format: "TV", status: "RELEASING", episodes: 150, averageScore: 81, description: "In a world where most people have superpowers, a powerless boy dreams of becoming a hero.", genres: ["Action", "School", "Adventure"], year: 2016 },
            { id: 5, title: "Naruto Shippuden", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b14790-AjHGwCrEbJMP.jpg", banner: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/14790-tJKvuLyMWBLW.jpg", format: "TV", status: "FINISHED", episodes: 500, averageScore: 82, description: "Ninjas fight in an epic saga of conflict and peace.", genres: ["Action", "Adventure", "Supernatural"], year: 2007 }
        ],
        popular: [
            { id: 5, title: "Naruto Shippuden", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b14790-AjHGwCrEbJMP.jpg", format: "TV", averageScore: 82 },
            { id: 6, title: "One Piece", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b11739-9k4PZBZ3U2Ef.jpg", format: "TV", averageScore: 80 },
            { id: 7, title: "Death Note", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b1438-lW8deXl5HIJv.jpg", format: "TV", averageScore: 84 },
            { id: 8, title: "Steins;Gate", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b9253-0EZ1K3ZAhCLI.jpg", format: "TV", averageScore: 88 },
            { id: 9, title: "Fullmetal Alchemist: Brotherhood", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b4224-O8sPSoKz0LQU.jpg", format: "TV", averageScore: 90 }
        ],
        upcoming: [
            { id: 50, title: "Solo Leveling", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b154587-Y32r2v5U2vMV.jpg", format: "TV" },
            { id: 51, title: "Elden Ring", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b174050-jzXx4RVjN1Dj.jpg", format: "TV" },
            { id: 52, title: "Frieren: Beyond Journey's End", poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b154587-Y32r2v5U2vMV.jpg", format: "TV" }
        ]
    };

    var MOCK_DETAILS = {
        1: {
            id: 1,
            title: "Jujutsu Kaisen",
            poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b113415-rIw9d3lkO8Jx.jpg",
            banner: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/113415-YmF4VGp0OTNwWk5m.jpg",
            format: "TV",
            status: "RELEASING",
            episodes: 24,
            averageScore: 87,
            description: "A high schooler encounters a cursed talisman and becomes the host of a powerful demon.",
            genres: ["Action", "Supernatural", "School"],
            year: 2020,
            duration: 24
        },
        2: {
            id: 2,
            title: "Attack on Titan",
            poster: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/b108064-4bKvZrw5eCr4.jpg",
            banner: "https://s4.anilist.co/file/anilistcdn/media/anime/banner/108064-dZM2mCDQXg0w.jpg",
            format: "TV",
            status: "FINISHED",
            episodes: 139,
            averageScore: 85,
            description: "Humanity fights for survival against giant man-eating creatures.",
            genres: ["Action", "Drama", "Fantasy"],
            year: 2013,
            duration: 24
        }
    };

    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================

    function normalizeTitle(title) {
        return String(title || "Unknown").trim();
    }

    function getTvType(format) {
        if (!format) return "series";
        var ft = String(format).toUpperCase();
        return ft === "MOVIE" ? "movie" : (ft === "OVA" || ft === "ONA" ? "anime" : "series");
    }

    function getStatus(status) {
        if (!status) return "unknown";
        var st = String(status).toUpperCase();
        if (st.indexOf("FINISHED") !== -1 || st.indexOf("COMPLETED") !== -1) return "completed";
        if (st.indexOf("RELEASING") !== -1 || st.indexOf("ONGOING") !== -1) return "ongoing";
        if (st.indexOf("NOT_YET") !== -1 || st.indexOf("UPCOMING") !== -1) return "upcoming";
        return "unknown";
    }

    function getPosterFallback() {
        return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='450' viewBox='0 0 300 450'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%23333;stop-opacity:1'/%3E%3Cstop offset='100%25' style='stop-color:%23555;stop-opacity:1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect fill='url(%23grad)' width='300' height='450'/%3E%3Ctext x='150' y='225' text-anchor='middle' dy='.3em' fill='%23ccc' font-size='18' font-weight='bold'%3EAnime%3C/text%3E%3C/svg%3E";
    }

    function createMultimediaItem(anime) {
        if (!anime || !anime.id) return null;

        var title = normalizeTitle(anime.title);
        var tvType = getTvType(anime.format);

        return new MultimediaItem({
            title: title,
            url: BASE_URL + "/info/" + anime.id,
            posterUrl: anime.poster || getPosterFallback(),
            type: tvType,
            year: anime.year || 0,
            score: anime.averageScore ? anime.averageScore / 10 : 0,
            description: anime.description || "",
            tags: anime.genres || [],
            headers: HEADERS,
        });
    }

    // ============================================================================
    // CORE FUNCTIONS
    // ============================================================================

    async function getHome(cb) {
        try {
            var pageData = {};

            // Trending
            pageData["Trending"] = MOCK_ANIME.trending.slice(0, 15).map(createMultimediaItem).filter(Boolean);

            // Popular
            pageData["Popular"] = MOCK_ANIME.popular.slice(0, 15).map(createMultimediaItem).filter(Boolean);

            // Upcoming
            pageData["Upcoming"] = MOCK_ANIME.upcoming.slice(0, 10).map(createMultimediaItem).filter(Boolean);

            cb({ success: true, data: pageData });
        } catch (e) {
            cb({
                success: false,
                errorCode: "GET_HOME_ERROR",
                message: String(e).substring(0, 200)
            });
        }
    }

    async function search(queryStr, cb) {
        try {
            if (!queryStr || queryStr.trim().length === 0) {
                cb({ success: true, data: [] });
                return;
            }

            var query = queryStr.toLowerCase();
            var results = [];

            // Search across all mock data
            var allAnime = MOCK_ANIME.trending.concat(MOCK_ANIME.popular).concat(MOCK_ANIME.upcoming);
            for (var i = 0; i < allAnime.length; i++) {
                var anime = allAnime[i];
                if (anime.title.toLowerCase().indexOf(query) !== -1 ||
                    (anime.description && anime.description.toLowerCase().indexOf(query) !== -1)) {
                    var item = createMultimediaItem(anime);
                    if (item) results.push(item);
                }
            }

            cb({ success: true, data: results.slice(0, 50) });
        } catch (e) {
            cb({ success: true, data: [] });
        }
    }

    async function load(url, cb) {
        try {
            var idMatch = url.match(/\/info\/(\d+)/i) || url.match(/id=(\d+)/i);
            var animeId = idMatch ? parseInt(idMatch[1], 10) : null;

            if (!animeId) {
                return cb({
                    success: false,
                    errorCode: "LOAD_ERROR",
                    message: "Invalid URL format"
                });
            }

            var anime = MOCK_DETAILS[animeId];
            if (!anime) {
                // Try to find in mock data
                var allAnime = MOCK_ANIME.trending.concat(MOCK_ANIME.popular).concat(MOCK_ANIME.upcoming);
                for (var i = 0; i < allAnime.length; i++) {
                    if (allAnime[i].id === animeId) {
                        anime = allAnime[i];
                        break;
                    }
                }
            }

            if (!anime) {
                return cb({
                    success: false,
                    errorCode: "LOAD_ERROR",
                    message: "Anime not found"
                });
            }

            var tvType = getTvType(anime.format);
            var season = tvType === "movie" ? 0 : 1;
            var totalEps = anime.episodes || 12;

            // Generate episodes
            var episodes = [];
            for (var ep = 1; ep <= Math.min(totalEps, 500); ep++) {
                episodes.push(
                    new Episode({
                        name: "Episode " + ep,
                        url: BASE_URL + "/watch?id=" + animeId + "&ep=" + ep,
                        season: season,
                        episode: ep,
                        posterUrl: anime.poster || getPosterFallback(),
                        dubStatus: "sub",
                        headers: HEADERS,
                    })
                );
            }

            var item = new MultimediaItem({
                title: normalizeTitle(anime.title),
                url: url,
                posterUrl: anime.poster || getPosterFallback(),
                type: tvType,
                bannerUrl: anime.banner || anime.poster || getPosterFallback(),
                description: anime.description || "",
                year: anime.year || 0,
                score: anime.averageScore ? anime.averageScore / 10 : 0,
                duration: anime.duration || 24,
                status: getStatus(anime.status),
                tags: anime.genres || [],
                cast: [],
                recommendations: [],
                episodes: episodes,
                headers: HEADERS,
            });

            cb({ success: true, data: item });
        } catch (e) {
            cb({
                success: false,
                errorCode: "LOAD_ERROR",
                message: String(e).substring(0, 200)
            });
        }
    }

    async function loadStreams(url, cb) {
        try {
            var idMatch = url.match(/id=(\d+)/i) || url.match(/\/watch\?id=(\d+)/i);
            var epMatch = url.match(/ep=(\d+)/i);
            var animeId = idMatch ? parseInt(idMatch[1], 10) : null;
            var epNumber = epMatch ? parseInt(epMatch[1], 10) : 1;

            if (!animeId) {
                return cb({
                    success: false,
                    errorCode: "STREAM_ERROR",
                    message: "Invalid URL format"
                });
            }

            // Return mock streams
            var streams = [
                new StreamResult({
                    url: "https://example-stream-1.cdn.com/video/" + animeId + "/ep" + epNumber + ".m3u8",
                    source: "Primary Stream",
                    quality: "1080p",
                    headers: HEADERS,
                }),
                new StreamResult({
                    url: "https://example-stream-2.cdn.com/video/" + animeId + "/ep" + epNumber + "/720p.m3u8",
                    source: "Secondary Stream",
                    quality: "720p",
                    headers: HEADERS,
                })
            ];

            cb({ success: true, data: streams });
        } catch (e) {
            cb({
                success: false,
                errorCode: "STREAM_ERROR",
                message: String(e).substring(0, 200)
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