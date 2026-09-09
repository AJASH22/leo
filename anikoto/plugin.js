(function() {
    /**
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    /**
     * Loads the home screen categories.
     * @param {(res: Response) => void} cb 
     */
    async function getHome(cb) {
        // Example: Using solveCaptcha if needed (await solveCaptcha(siteKey, url))
        try {
            // Dashboard Layout:
            // - "Trending" is a reserved category promoted to the Hero Carousel.
            // - Other categories appear as horizontal thumbnail rows.
            // - If "Trending" is missing, the first category is used for the carousel.
            cb({ 
                success: true, 
                data: { 
                    "Trending": [
                        new MultimediaItem({ 
                            title: "Example Movie (Carousel)", 
                            url: `${manifest.baseUrl}/movie`, 
                            posterUrl: `https://anikototv.to/images/anime/placeholder.jpg?text=Trending+Movie`, 
                            type: "movie", // Valid types: movie, series, anime, livestream, other
                            bannerUrl: `https://anikototv.to/images/anime/banner.jpg?text=Trending+Banner`, // (optional)
                            description: "Plot summary here...", // (optional)
                            headers: { "Referer": `${manifest.baseUrl}` } // (optional)
                        })
                    ],
                    "Latest Series": [
                        new MultimediaItem({ 
                            title: "Example Series (Thumb)", 
                            url: `${manifest.baseUrl}/series`, 
                            posterUrl: `https://anikototv.to/images/anime/placeholder.jpg?text=Series+Poster`, 
                            type: "series",
                            description: "This category appears as a thumbnail row."
                        })
                    ]
                } 
            });
        } catch (e) {
            cb({ success: false, errorCode: "PARSE_ERROR", message: e.stack });
        }
    }

    /**
     * Searches for media items.
     * @param {string} query
     * @param {(res: Response) => void} cb 
     */
    async function search(query, cb) {
        try {
            // Standard: Return a List of items
            // Samples show both a movie and a series
            cb({ 
                success: true, 
                data: [
                        new MultimediaItem({ 
                            title: "Example Movie (Search Result)", 
                            url: `${manifest.baseUrl}/movie`, 
                            posterUrl: `https://anikototv.to/images/anime/placeholder.jpg?text=Search+Movie`, 
                            type: "movie", 
                            bannerUrl: `https://anikototv.to/images/anime/banner.jpg?text=Search+Banner`,
                            description: "Plot summary here...", 
                            headers: { "Referer": `${manifest.baseUrl}` } 
                        }),
                        new MultimediaItem({ 
                            title: "Example Series (Search Result)", 
                            url: `${manifest.baseUrl}/series`, 
                            posterUrl: `https://anikototv.to/images/anime/placeholder.jpg?text=Search+Series`, 
                            type: "series", 
                            description: "A series found in search.", 
                            headers: { "Referer": `${manifest.baseUrl}` } 
                        })
                ] 
            });
        } catch (e) {
            cb({ success: false, errorCode: "SEARCH_ERROR", message: e.stack });
        }
    }

    /**
     * Loads details for a specific media item.
     * @param {string} url
     * @param {(res: Response) => void} cb 
     */
    async function load(url, cb) {
        try {
            // Standard: Return a single item with full metadata
            // Sample shows a series with episodes
            cb({ 
                success: true, 
                data: new MultimediaItem({
                    title: "Example Series Full Details",
                    url: url,
                    posterUrl: `https://anikototv.to/images/anime/placeholder.jpg?text=Series+Details`,
                    type: "series", 
                    bannerUrl: `https://anikototv.to/images/anime/banner.jpg?text=Series+Banner`,
                    description: "This is a detailed description of the media.", 
                    year: 2024,
                    score: 8.5,
                    duration: 120, // (optional, in minutes)
                    status: "ongoing", // ongoing, completed, upcoming
                    contentRating: "PG-13",
                    logoUrl: `https://anikototv.to/images/anime/logo.jpg`,
                    isAdult: false,
                    tags: ["Action", "Adventure"],
                    cast: [
                        new Actor({ name: "John Doe", role: "Protagonist", image: "https://anikototv.to/images/anime/actor.jpg" })
                    ],
                    trailers: [
                        new Trailer({ name: "Official Trailer", url: "https://www.youtube.com/watch?v=..." })
                    ],
                    nextAiring: new NextAiring({ episode: 5, season: 1, airDate: "2024-04-01" }),
                    recommendations: [
                        new MultimediaItem({ title: "Similar Show", url: `${manifest.baseUrl}/similar`, posterUrl: "https://anikototv.to/images/anime/placeholder.jpg", type: "series" })
                    ],
                    playbackPolicy: "none", // 'none' | 'VPN Recommended' | 'torrent' | 'externalPlayerOnly' | 'internalPlayerOnly'
                    syncData: { "my_service_id": "12345" }, // Optional: external metadata sync
                    streams: [
                        // Optional: "Instant Load" - bypass loadStreams by providing links here
                        new StreamResult({ url: "https://anikototv.to/movie.mp4", source: "Instant High" })
                    ],
                    headers: { "Referer": `${manifest.baseUrl}` }, 
                    episodes: [
                        new Episode({ 
                            name: "Episode 1", 
                            url: `${manifest.baseUrl}/watch/1`, 
                            season: 1, 
                            episode: 1, 
                            description: "Episode summary...", 
                            posterUrl: `https://anikototv.to/images/anime/placeholder.jpg?text=Episode+Poster`,
                            headers: { "Referer": `${manifest.baseUrl}` },
                            dubStatus: "sub",
                            streams: [] // Optional: "Instant Load" for episodes
                        }),
                        new Episode({ 
                            name: "Episode 2", 
                            url: `${manifest.baseUrl}/watch/2`, 
                            season: 1, 
                            episode: 2, 
                            description: "Next episode summary...", 
                            posterUrl: `https://anikototv.to/images/anime/placeholder.jpg?text=Episode+Poster`,
                            headers: { "Referer": `${manifest.baseUrl}` },
                            dubStatus: "sub"
                        })
                    ]
                })
            });
        } catch (e) {
            cb({ success: false, errorCode: "LOAD_ERROR", message: e.stack });
        }
    }

    /**
     * Resolves streams for a specific media item or episode.
     * @param {string} url
     * @param {(res: Response) => void} cb 
     */
    async function loadStreams(url, cb) {
        try {
            // Standard: Return a List of stream objects
            cb({ 
                success: true, 
                data: [
                    new StreamResult({ 
                        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", 
                        source: "Direct Quality", 
                        headers: { "Referer": `${manifest.baseUrl}` }
                    })
                ] 
            });
        } catch (e) {
            cb({ success: false, errorCode: "STREAM_ERROR", message: String(e) });
        }
    }

    // Export to global scope for namespaced IIFE capture
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
