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
  cb({
    success: false,
    errorCode: "STREAMS_UNAVAILABLE",
    message: "Stream loading is disabled while the catalog integration is being validated."
  });
}

module.exports = {
  getHome,
  search,
  load,
  loadStreams
};


