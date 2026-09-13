const API = "https://anikoto-api-6643.onrender.com/api";

async function api(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return await r.json();
}

function arr(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.results)) return x.results;
  if (Array.isArray(x?.results?.data)) return x.results.data;
  if (Array.isArray(x?.data)) return x.data;
  return [];
}

function item(x) {
  if (!x || typeof x !== "object") return null;

  const id =
    x.id ??
    x.slug ??
    x.anime_id ??
    x.animeId ??
    x.href ??
    x.url;

  const title =
    x.title ??
    x.name ??
    x.anime_name ??
    x.animeName ??
    x.english ??
    x.japanese;

  if (!id || !title) return null;

  const poster =
    x.poster ??
    x.image ??
    x.poster_url ??
    x.image_url ??
    x.thumbnail ??
    x.cover;

  return {
    id: String(id),
    title: String(title),
    ...(poster ? { image: String(poster) } : {})
  };
}

function mapItems(x) {
  return arr(x).map(item).filter(Boolean).slice(0, 20);
}

async function safe(name, path) {
  try {
    const data = await api(path);
    const items = mapItems(data);
    return items.length ? { name, items } : null;
  } catch (e) {
    console.log(`[AniKoto] ${name}: ${e?.message ?? String(e)}`);
    return null;
  }
}

async function getHome(cb) {
  const sections = [];

  const jobs = [
    ["Trending", "/trending"],
    ["Most Popular", "/most-popular?page=1"],
    ["New Release", "/new-release?page=1"],
    ["Newly Added", "/newly-added?page=1"],
    ["Upcoming", "/upcoming"],
    ["Completed", "/completed"]
  ];

  for (const [name, path] of jobs) {
    const section = await safe(name, path);
    if (section) sections.push(section);
  }

  if (!sections.length) {
    cb({
      success: false,
      errorCode: "GETHOME_ERROR",
      message: "AniKoto API returned no usable home sections. Check API connectivity/CORS in SkyStream logs."
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
    const q = encodeURIComponent(query ?? "");
    const data = await api(`/search?query=${q}`);
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
    const u = new URL(url);
    const id =
      u.searchParams.get("id") ||
      u.searchParams.get("slug");

    if (!id) {
      cb({
        success: false,
        errorCode: "LOAD_ERROR",
        message: "Missing anime id"
      });
      return;
    }

    const data = await api(`/info?id=${encodeURIComponent(id)}`);
    const r = data?.results ?? data?.data ?? data;

    cb({
      success: true,
      data: {
        id: String(id),
        title: String(r?.title ?? r?.name ?? id),
        description: String(r?.description ?? ""),
        image: r?.poster ? String(r.poster) : undefined
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
    message: "Stream loading is disabled in this diagnostic build."
  });
}

module.exports = {
  getHome,
  search,
  load,
  loadStreams
};
