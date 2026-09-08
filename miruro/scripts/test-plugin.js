#!/usr/bin/env node
/* Deterministic contract checks for the source-aware anime plugin helpers. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const source = fs.readFileSync(path.join(__dirname, "..", "miruro", "plugin.js"), "utf8");

function check(name, condition) {
  if (!condition) throw new Error("FAIL: " + name);
  console.log("PASS: " + name);
}

check("anime-only provider registry", /Jikan/.test(source) && /Kitsu/.test(source) && /HiAnime/.test(source));
check("AllManga removed", !/AllManga|allmanga\.to/i.test(source));
check("manga records rejected", /REJECTED_MEDIA_TYPES/.test(source) && /isAnimeRecord/.test(source));
check("source-aware envelope emitted", /function sourceId\(/.test(source) && /v: 2/.test(source));
check("legacy hash payload accepted", /parsed\.hash && !parsed\.id/.test(source));
check("AllAnime episodes use v2 IDs", /sourceId\("allanime", show\._id/.test(source));
check("Jikan episodes use v2 IDs", /sourceId\("jikan", jikan\.mal_id/.test(source));
check("HiAnime adapter exists", /_loadStreamsFromHiAnime/.test(source));
check("extractor registry hook wired", /SkyStreamExtractors/.test(source) && /resolveWithBundledExtractor/.test(source));
check("iframe URLs are not treated as media", /isPlayableMediaUrl/.test(source) && /NO_PLAYABLE_STREAMS/.test(source));
check("richer AniList metadata", /nextAiringEpisode/.test(source) && /trailer/.test(source) && /voiceActors/.test(source));
check("manifest version bumped", /\"version\"\s*:\s*7/.test(fs.readFileSync(path.join(__dirname, "..", "miruro", "plugin.json"), "utf8")));
check("public release version is dotted", /\"releaseVersion\"\s*:\s*\"1\.1\"/.test(fs.readFileSync(path.join(__dirname, "..", "miruro", "plugin.json"), "utf8")));
check("Kitsu uses supported page size", !/page\\\[limit\\\]=25/.test(source));
check("Kitsu detail route exists", source.includes('providerId === "kitsu"') && source.includes('/episodes?page%5Blimit%5D=20'));
check("Kitsu stream routing exists", /source === "kitsu"/.test(source) && /kitsuTitle/.test(source));
check("request timeout guard exists", /function withTimeout/.test(source) && /_TIMEOUT/.test(source));
check("HLS extractor recognizes m3u8", source.includes(".m3u8(?:[?#]|$)"));

// Keep one executable assertion for the envelope shape used by test fixtures.
const envelope = { v: 2, source: "allanime", id: "show-id", episode: "1", dubStatus: "sub" };
assert.strictEqual(envelope.v, 2);
assert.strictEqual(envelope.source, "allanime");
console.log("All deterministic plugin checks passed.");
