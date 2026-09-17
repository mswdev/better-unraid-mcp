import { execSync } from "node:child_process";
// Builds the Claude Desktop one-click bundle: build/better-unraid-mcp-<version>.mcpb
// Stages dist/, schema/, manifest.json and production node_modules, then runs `mcpb pack`.
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const STAGE = "build/mcpb";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const bundle = `build/better-unraid-mcp-${version}.mcpb`;

rmSync("build", { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
for (const entry of ["dist", "schema", "manifest.json", "package.json", "package-lock.json"]) {
  cpSync(entry, `${STAGE}/${entry}`, { recursive: true });
}
execSync("npm ci --omit=dev --ignore-scripts --no-audit --no-fund", {
  cwd: STAGE,
  stdio: "inherit",
});
execSync(`npx --yes @anthropic-ai/mcpb@2 pack ${STAGE} ${bundle}`, { stdio: "inherit" });
console.log(`bundle: ${bundle}`);
