#!/usr/bin/env node

/**
 * Bump the SkyStream plugin manifest version.
 *
 * Usage:
 *   node scripts/bump-version.js patch
 *   node scripts/bump-version.js minor
 *   node scripts/bump-version.js major
 */

const fs = require("fs");
const path = require("path");

const part = process.argv[2] || "patch";
const increments = { major: [1, 0, 0], minor: [0, 1, 0], patch: [0, 0, 1] };

if (!increments[part]) {
  console.error(`Unknown version part "${part}". Use major, minor, or patch.`);
  process.exit(1);
}

const manifestPath = path.resolve(__dirname, "..", "miruro", "plugin.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const current = Number(manifest.version);

if (!Number.isInteger(current) || current < 1) {
  console.error(`Invalid manifest version: ${manifest.version}`);
  process.exit(1);
}

const delta = increments[part];
// SkyStream manifests use a positive integer version rather than semver. Treat each
// requested bump as one release while preserving the major/minor/patch CLI interface.
manifest.version = current + delta[0] * 10000 + delta[1] * 100 + delta[2];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Updated ${manifest.packageName} from ${current} to ${manifest.version}`);
