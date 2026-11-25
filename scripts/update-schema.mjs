// Refreshes the vendored Unraid API schema and records the upstream version it came from.
// Usage: npm run schema:update  (then: npm run generate)
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const RAW_BASE = "https://raw.githubusercontent.com/unraid/api/main/api";
const SDL_PATH = "schema/unraid.graphql";
const VERSION_PATH = "schema/schema-version.json";
const HEADER =
  "# Vendored from https://github.com/unraid/api (api/generated-schema.graphql).\n# DO NOT EDIT BY HAND. Refresh with `npm run schema:update`.\n";
const JSON_INDENT_SPACES = 2;

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  return response.text();
}

/** The upstream version the last refresh recorded, or null when there is no sidecar yet. */
function recordedApiVersion() {
  if (!existsSync(VERSION_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(VERSION_PATH, "utf8")).apiVersion ?? null;
}

/**
 * True when the vendored SDL and the recorded version already match upstream.
 * Rewriting then would only move fetchedAt, which made the weekly drift check
 * open a pull request every week even when nothing had changed.
 */
function isAlreadyCurrent(vendoredSdl, apiVersion) {
  const currentSdl = existsSync(SDL_PATH) ? readFileSync(SDL_PATH, "utf8") : null;
  return currentSdl === vendoredSdl && recordedApiVersion() === apiVersion;
}

/** Writes the refreshed SDL and the sidecar recording where and when it came from. */
function writeRefresh(vendoredSdl, apiVersion) {
  const sidecar = {
    apiVersion,
    source: "https://github.com/unraid/api",
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(SDL_PATH, vendoredSdl);
  writeFileSync(VERSION_PATH, `${JSON.stringify(sidecar, null, JSON_INDENT_SPACES)}\n`);
  console.log(`${SDL_PATH} refreshed from unraid/api ${apiVersion}; recorded in ${VERSION_PATH}`);
}

const [sdl, packageJson] = await Promise.all([
  fetchText(`${RAW_BASE}/generated-schema.graphql`),
  fetchText(`${RAW_BASE}/package.json`).then((text) => JSON.parse(text)),
]);

const vendoredSdl = HEADER + sdl;
if (isAlreadyCurrent(vendoredSdl, packageJson.version)) {
  console.log(`${SDL_PATH} already matches unraid/api ${packageJson.version}; nothing to update`);
} else {
  writeRefresh(vendoredSdl, packageJson.version);
}
