// Refreshes the vendored Unraid API schema and records the upstream version it came from.
// Usage: npm run schema:update  (then: npm run generate)
import { writeFileSync } from "node:fs";

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

const [sdl, packageJson] = await Promise.all([
  fetchText(`${RAW_BASE}/generated-schema.graphql`),
  fetchText(`${RAW_BASE}/package.json`).then((text) => JSON.parse(text)),
]);

const sidecar = {
  apiVersion: packageJson.version,
  source: "https://github.com/unraid/api",
  fetchedAt: new Date().toISOString(),
};
writeFileSync(SDL_PATH, HEADER + sdl);
writeFileSync(VERSION_PATH, `${JSON.stringify(sidecar, null, JSON_INDENT_SPACES)}\n`);
console.log(
  `${SDL_PATH} refreshed from unraid/api ${packageJson.version}; recorded in ${VERSION_PATH}`,
);
