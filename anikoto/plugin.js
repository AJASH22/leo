const API = "https://anikoto-api-6643.onrender.com/api";

async function api(path) {
  const response = await http_get(API + path, {});

  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response?.status ?? "unknown"} ${path}`);
  }

  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error(`Invalid JSON from ${path}`);
  }
}

function arr(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.results?.data)) return value.results.data;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function normalize(item) {
  if (!item || typeof item !== "object") return null;

  const id =
    item.id ??
    item.slug ??
    item.anime_id ??
    item.animeId ??
    item.href ??
    item.url;

  const title =
    item.title ??
    item.name ??
    item.anime_name ??
    item.animeName ??
    item.english ??
    item.japanese;

  if (!id || !title) return null;

  const poster =
    item.poster ??
    item.image ??
    item.poster_url ??
    item.image_url ??
    item.thumbnail ??
    item.cover;

  const slug = String(id);

  return {
    title: String(title),
    url: `https://anikoto.cz/info?id=${encodeURIComponent(slug)}`,
    posterUrl: poster ? String(poster) : "",
    type: "anime"
  };
}

function mapItems(value) {
  return arr(value)
    .map(normalize)
    .filter(Boolean)
    .slice(0, 20);
}

async function getHome(cb) {
  const jobs = [
    ["Trending", "/trending"],
    ["Most Popular", "/most-popular?page=1"],
    ["New Release", "/new-release?page=1"],
    ["Newly Added", "/newly-added?page=1"],
    ["Upcoming", "/upcoming"],
    ["Completed", "/completed"]
  ];

  const sections = [];

  for (const [name, path] of jobs) {
    try {
      const data = await api(path);
      const items = mapItems(data);

      if (items.length) {
        sections.push({
          title: name,
          items
        });
      }
    } catch (e) {
      console.log(`[AniKoto] ${name}: ${e?.message ?? String(e)}`);
    }
  }

  if (!sections.length) {
    cb({
      success: false,
      errorCode: "GETHOME_ERROR",
      message: "AniKoto API returned no usable home sections."
    });
    return;
  }

  cb({
    success: true,
    data: sections
  });
}

async function search(query, cb) {
  try {
    const data = await api(`/search?keyword=${encodeURIComponent(query ?? "")}&page=1`);

    cb({
      success: true,
      data: mapItems(data)
    });
  } catch (e) {
    cb({
      success: false,
      errorCode: "SEARCH_ERROR",
      message: e?.message ?? String(e)
    });
  }
}

async function load(url, cb) {
  try {
    const parsed = new URL(url);

    const id =
      parsed.searchParams.get("id") ??
      parsed.searchParams.get("slug");

    if (!id) {
      cb({
        success: false,
        errorCode: "LOAD_ERROR",
        message: "Missing anime id."
      });
      return;
    }

    const data = await api(`/info?id=${encodeURIComponent(id)}`);
    const result = data?.results ?? data?.data ?? data;

    const title =
      result?.title ??
      result?.name ??
      id;

    const description =
      result?.description ??
      "";

    const poster =
      result?.poster ??
      result?.image ??
      result?.poster_url ??
      "";

    cb({
      success: true,
      data: {
        title: String(title),
        url: String(url),
        description: String(description),
        posterUrl: poster ? String(poster) : "",
        type: "anime"
      }
    });
  } catch (e) {
    cb({
      success: false,
      errorCode: "LOAD_ERROR",
      message: e?.message ?? String(e)
    });
  }
}

async function loadStreams(url, cb) {
  try {
    // Extract anime slug and episode number from the URL
    let animeSlug = "";
    let episodeNum = 1;
    try {
      const u = new URL(url);
      if (u.pathname.startsWith("/watch/")) {
        const pathParts = u.pathname.split("/");
        if (pathParts.length >= 3) {
          animeSlug = pathParts[2]; // because /watch/<slug>/...? but note: the bundled code does: u.pathname.split("/") -> ["", "watch", slug, ...]
          // Then they take the first segment of the slug (in case there are slashes in the slug?) and decode it?
          // Actually, they do: let v=decodeURIComponent(t).split("/")[0]; t=encodeURIComponent(v)
          // This is to handle if the slug has slashes? But note: the slug in the URL is the anime id, which should not have slashes.
          // However, the bundled code does:
          //   let v=decodeURIComponent(t).split("/")[0];
          //   t=encodeURIComponent(v);
          // So we do the same.
          const slugPart = decodeURIComponent(animeSlug).split("/")[0];
          animeSlug = encodeURIComponent(slugPart);
        }
      }
      const ep = u.searchParams.get("ep");
      if (ep) {
        episodeNum = parseInt(ep);
      }
    } catch (e) {
      // Fallback to regex
      const match = url.match(/\/watch\/([^/?]+)(?:[?&]ep=(\d+))?/);
      if (match) {
        animeSlug = encodeURIComponent(decodeURIComponent(match[1]).split("/")[0]);
        if (match[2]) {
          episodeNum = parseInt(match[2]);
        }
      } else {
        throw new Error("Could not extract anime slug from URL");
      }
    }

    if (!animeSlug) {
      throw new Error("Could not extract anime slug from URL");
    }

    // Fetch episode list for the anime
    const episodeListResponse = await api(`/episodes/${encodeURIComponent(animeSlug)}`);
    if (!episodeListResponse || !episodeListResponse.success) {
      throw new Error("Failed to fetch episode list");
    }

    const episodes = episodeListResponse.results && episodeListResponse.results.episodes;
    if (!Array.isArray(episodes)) {
      throw new Error("Failed to fetch episode list");
    }

    // Find the episode by episode number
    const episodeInfo = episodes.find(ep => ep.episode_no === episodeNum);
    if (!episodeInfo) {
      throw new Error(`Episode ${episodeNum} not found`);
    }

    if (!episodeInfo.server_ids) {
      throw new Error("Episode missing server IDs");
    }

    // Fetch server list for the episode
    const serverListResponse = await api(`/servers?ids=${encodeURIComponent(episodeInfo.server_ids)}`);
    if (!serverListResponse || !serverListResponse.success || !serverListResponse.results) {
      throw new Error("Failed to fetch server list");
    }

    const servers = serverListResponse.results;
    if (!Array.isArray(servers) || servers.length === 0) {
      throw new Error("No servers found");
    }

    const streams = [];
    let lastError = null;

    for (const server of servers) {
      if (!server || !server.link_id) {
        continue;
      }
      try {
        const streamResponse = await api(`/stream?id=${encodeURIComponent(server.link_id)}`);
        if (!streamResponse || !streamResponse.success || !streamResponse.results) {
          lastError = new Error("Failed to fetch stream info");
          continue;
        }

        const streamData = streamResponse.results;
        if (!streamData.url) {
          lastError = new Error("No stream URL available");
          continue;
        }

        // Build the stream object
        const streamObj = {
          url: streamData.url,
          headers: streamData.headers || {}
        };

        if (streamData.type) {
          streamObj.quality = streamData.type.toUpperCase();
        }

        if (streamData.skipData) {
          streamObj.intro = {
            start: streamData.skipData.intro_start || 0,
            end: streamData.skipData.intro_end || 0
          };
          streamObj.outro = {
            start: streamData.skipData.outro_start || 0,
            end: streamData.skipData.outro_end || 0
          };
        }

        streams.push(streamObj);
      } catch (e) {
        lastError = e;
        continue;
      }
    }

    if (streams.length === 0) {
      throw lastError || new Error("No working streams found");
    }

    cb({
      success: true,
      data: streams
    });
  } catch (e) {
    cb({
      success: false,
      errorCode: "STREAM_ERROR",
      message: e.message || String(e)
    });
  }
}

module.exports = {
  getHome,
  search,
  load,
  loadStreams
};


