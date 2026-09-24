// ReAnime Plugin for SkyStream
// Implements getHome, search, load, loadStreams using ReAnime API
// Author: ajash

const BASE = "https://reanime.to";

function normalizeUrl(url, base) {
  if (!url) return null;
  try { return new URL(url, base).href; } catch { return url; }
}

async function getHome(cb) {
  try {
    const res = await http_get(BASE + "/api/v1/home", { Accept: "application/json" });
    if (!res || res.status !== 200) throw new Error("failed to fetch home");
    const data = JSON.parse(res.body || res);
    const result = {};
    const mapSection = (key, title) => {
      const items = data[key] || [];
      if (items && items.length) {
        result[title] = items.map(it => ({
          title: it.title?.english ?? it.title?.native ?? it.anime_id,
          url: BASE + "/anime/" + it.anime_id,
          posterUrl: it.cover_image?.large || it.cover_image?.medium || it.cover_image?.small || ""
        }));
      }
    };
    mapSection("latest_aired", "Latest Airing");
    mapSection("new_on_site", "New on Site");
    mapSection("trending", "Trending");
    mapSection("upcoming", "Upcoming");
    if (Object.keys(result).length === 0) return cb({ success: false, message: "No home sections" });
    cb({ success: true, data: result });
  } catch (e) {
    cb({ success: false, errorCode: "GETHOME_ERROR", message: e.message });
  }
}

async function search(query, cb) {
  if (!query) return cb({ success: true, data: [] });
  try {
    const res = await http_get(BASE + "/api/v1/search?q=" + encodeURIComponent(query) + "&page=1", { Accept: "application/json" });
    if (!res || res.status !== 200) throw new Error("search failed");
    const data = JSON.parse(res.body || res);
    const items = (data.results || data).map(it => ({
      title: it.title?.english ?? it.title?.native ?? it.anime_id,
      url: BASE + "/anime/" + it.anime_id,
      posterUrl: it.cover_image?.large || it.cover_image?.medium || it.cover_image?.small || ""
    }));
    cb({ success: true, data: items });
  } catch (e) {
    cb({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
  }
}

async function load(url, cb) {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean)[1];
    if (!slug) throw new Error("Invalid anime URL");
    const res = await http_get(BASE + "/api/v1/anime/" + slug, { Accept: "application/json" });
    if (!res || res.status !== 200) throw new Error("Failed to load anime details");
    const data = JSON.parse(res.body || res);
    const item = {
      title: data.title?.english ?? data.title?.native ?? slug,
      url: url,
      description: data.description || "",
      posterUrl: data.cover_image?.large || data.cover_image?.medium || data.cover_image?.small || "",
      subtitles: (data.subtitles || []).map(s => ({ url: s.url, language: s.language, format: s.format, defaultSubtitle: s.default }))
    };
    cb({ success: true, data: item });
  } catch (e) {
    cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
  }
}

async function loadStreams(url, cb) {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean)[1];
    const ep = parsed.searchParams.get("ep") || "1";
    const animeRes = await http_get(BASE + "/api/v1/anime/" + slug, { Accept: "application/json" });
    if (!animeRes || animeRes.status !== 200) throw new Error("Failed to fetch anime for stream");
    const animeData = JSON.parse(animeRes.body || animeRes);
    const anilistId = animeData.anilist_id || animeData.anilistId || animeData.id;
    if (!anilistId) throw new Error("Missing anilist ID");
    const flixRes = await http_get(BASE + "/api/flix/" + anilistId + "/" + ep, { Accept: "application/json" });
    if (!flixRes || flixRes.status !== 200) throw new Error("Failed to fetch flix data");
    const flix = JSON.parse(flixRes.body || flixRes);
    const streams = flix.servers.map(s => ({
      url: s.dataLink,
      quality: s.serverName.split("-")[1] || s.serverName,
      subtitles: [],
      source: "Flixcloud"
    }));
    // deduplicate by unique url+quality
    const seen = new Set();
    const uniqueStreams = streams.filter(s => {
      const key = s.url + "|" + s.quality;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    cb({ success: true, data: uniqueStreams });
  } catch (e) {
    cb({ success: false, errorCode: "STREAM_ERROR", message: e.message });
  }
}

module.exports = { getHome, search, load, loadStreams };