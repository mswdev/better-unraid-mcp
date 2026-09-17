# Phase 6 "Launch & distribution" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the launch kit against 0.1.0 with no version bump: final forum post text, official MCP Registry metadata + publish instructions, a Claude Code plugin marketplace in-repo, an MCPB bundle built and attached to every GitHub Release, a Docker image on ghcr.io for the HTTP transport, a README demo + badge refresh, plus the two pre-approved CI additions (weekly schema-drift job, Dependabot).

**Architecture:** Everything is configuration and packaging around the existing `dist/` build. `scripts/build-mcpb.mjs` stages `dist/`, `schema/`, `manifest.json`, and production `node_modules` into `build/mcpb/` and runs `@anthropic-ai/mcpb pack`. `Dockerfile` is a two-stage Node 20 alpine build whose runtime image runs `node dist/index.js` with `MCP_TRANSPORT=http` and `MCP_HTTP_HOST=0.0.0.0` defaults (bearer token still mandatory). Workflows: `release.yml` gains an MCPB build + `gh release upload` step after the tag/release step; new `docker.yml` (on `v*` tags and manual dispatch) publishes `ghcr.io/mswdev/better-unraid-mcp:<version>` and `:latest`; new `schema-drift.yml` (weekly + manual) runs `npm run schema:update && npm run generate` and opens a PR when anything changed; `dependabot.yml` for npm + GitHub Actions.

**Tech Stack:** `@anthropic-ai/mcpb` (dev dependency, CLI), Docker (multi-stage), GitHub Actions (`docker/login-action`, `docker/build-push-action`, `peter-evans/create-pull-request`).

**Spec:** `docs/superpowers/specs/2026-09-15-roadmap-2-design.md` §6 Phase 6; workflow grant in the kickoff prompt: schema-drift job, Dependabot, MCPB/Docker release-workflow artifacts — nothing else.

## Verified facts (2026-09-17)

- MCP Registry: publish via the `mcp-publisher` CLI (`brew install mcp-publisher`; `mcp-publisher login github` is interactive, `login github-oidc` exists for CI); npm packages must carry `"mcpName": "io.github.mswdev/better-unraid-mcp"` in the published package.json (added in PR #59 so 0.1.0 carries it); `server.json` schema `2025-12-11`; registry base URLs restricted to registry.npmjs.org / ghcr.io / GitHub releases for MCPB.
- MCPB: `@anthropic-ai/mcpb@2.1.2` on npm (`mcpb init|pack|validate`); manifest_version `0.3`; node servers bundle `node_modules`; `user_config` → `${user_config.key}` substitution into `mcp_config.env`; `sensitive: true` for secrets.
- Smithery CLI 4.11: `smithery mcp publish ./bundle.mcpb -n mswdev/better-unraid-mcp` (owner login required) — handoff.
- Claude Code plugins: marketplace = `.claude-plugin/marketplace.json` at a repo root listing plugins; a plugin = directory with `.claude-plugin/plugin.json` + `.mcp.json` (env via `${VAR}`); install with `claude plugin marketplace add mswdev/better-unraid-mcp`.
- No terminal recorder (vhs/asciinema/agg) is installed on this machine; ffmpeg is. → the "demo GIF" ships as a hand-authored **animated SVG** transcript (`docs/assets/demo.svg`, SMIL animation renders inside GitHub READMEs via `<img>`), decision-logged; a real recording is a handoff item.

## Global Constraints

- Branch `feature/phase-6-launch` off `develop`; draft PR into `develop`; gate before every commit; no `npm version` (Phase 6 ships against 0.1.0 — the spec's status table gets `done`, not `released`).
- Workflow edits limited to: `release.yml` (MCPB artifact step), new `docker.yml`, new `schema-drift.yml`, new `dependabot.yml`.
- Never commit credentials; Docker image runs as a non-root user; the HTTP transport keeps refusing to start without `MCP_HTTP_BEARER_TOKEN`.

---

### Task 1: MCPB bundle (`manifest.json`, `scripts/build-mcpb.mjs`, release step)
- `manifest.json` at repo root (manifest_version 0.3, node server, entry `dist/index.js`, `mcp_config.command: node`, args `["${__dirname}/dist/index.js"]`, env from `user_config`: `UNRAID_API_URL` (string, required), `UNRAID_API_KEY` (string, sensitive, required), `UNRAID_SSH_HOST`, `UNRAID_SSH_PASSWORD` (sensitive), `MCP_READ_ONLY` (boolean, default false); `compatibility.runtimes.node ">=20"`; keywords, license, repository, icon omitted).
- `scripts/build-mcpb.mjs`: clean `build/mcpb`, copy `manifest.json dist schema package.json package-lock.json`, `npm ci --omit=dev --ignore-scripts` inside, `npx @anthropic-ai/mcpb pack build/mcpb build/better-unraid-mcp-<version>.mcpb`; `npm run build:mcpb` script; `build/` in `.gitignore`.
- Verify locally: `npx @anthropic-ai/mcpb validate manifest.json`, pack succeeds, bundle lists `dist/index.js`.
- `release.yml`: after the tag/release step, `npm run build && npm run build:mcpb` and `gh release upload "$TAG" build/*.mcpb --clobber` (runs when `tag == true`).
- README: "Claude Desktop one-click (.mcpb)" install paragraph.

### Task 2: Docker image (`Dockerfile`, `.dockerignore`, `docker.yml`, README)
- Multi-stage: builder `node:20-alpine` (`npm ci`, `npm run build`, `npm prune --omit=dev`); runtime `node:20-alpine` non-root `node` user, copies `dist schema package.json node_modules`, `ENV MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=3000`, `EXPOSE 3000`, `CMD ["node","dist/index.js"]`, `HEALTHCHECK` hitting `/mcp` unauthenticated expecting 401.
- `docker.yml`: on `push: tags: ['v*']` + `workflow_dispatch`; `permissions: packages: write`; login to ghcr with `GITHUB_TOKEN`; `docker/metadata-action` tags `<version>` + `latest`; build-push linux/amd64 + arm64.
- Local check: `docker build -t better-unraid-mcp:local .` and a run without token exits 1 with the env error; with token, `curl -o /dev/null -w %{http_code}` = 401.
- README "Docker (HTTP transport)" section with the compose snippet.

### Task 3: Claude Code plugin marketplace + Smithery handoff
- `.claude-plugin/marketplace.json` (name `better-unraid-mcp`, owner mswdev, plugin `better-unraid` at `./plugins/better-unraid`), `plugins/better-unraid/.claude-plugin/plugin.json` (name, version 0.1.0, description, author, repository, license, keywords, `mcpServers: "./.mcp.json"`), `plugins/better-unraid/.mcp.json` (`npx -y better-unraid-mcp@latest`, env `UNRAID_API_URL/KEY` + optional SSH from `${...}`), `plugins/better-unraid/README.md`.
- Validate with `claude plugin validate plugins/better-unraid` (if available) and by adding the marketplace from the local path.
- `docs/launch/distribution.md`: step-by-step owner handoff for Registry (`mcp-publisher login github` → `mcp-publisher publish`), Smithery (`smithery mcp publish ./build/*.mcpb -n mswdev/better-unraid-mcp`), marketplace install command, MCPB download.

### Task 4: Schema-drift job + Dependabot
- `.github/workflows/schema-drift.yml`: `schedule: cron '0 6 * * 1'` + dispatch; `npm ci`, `npm run schema:update`, `npm run generate`, `npm run typecheck || true` (report), then `peter-evans/create-pull-request@v7` on branch `chore/schema-drift` into `develop` with a body listing the upstream version from `schema/schema-version.json`; `permissions: contents: write, pull-requests: write`.
- `.github/dependabot.yml`: npm weekly (grouped minor/patch), github-actions weekly; target-branch `develop`.

### Task 5: Forum post, README demo + badges, status table, decisions
- `docs/launch/forum-post.md`: 67 tools; add services/shares/unassigned, flash backup, doctor CLI, metric history, SDK v2/protocol 2026-07-28, install options (npx, .mcpb, Docker, plugin marketplace); remove "flash backup is a stub" caveat (now SSH-based); keep the honest caveats.
- README: `docs/assets/demo.svg` animated transcript embedded after the tagline; badges: add MCP Registry (static shield linking to the registry search) + Docker (ghcr) + MCPB release asset; "Install" section gains the three new options; final pass for 0.1.0 reality (67 tools, doctor, history, SDK v2).
- Decision log **D37** (mcpName shipped in 0.1.0 via PR #59; registry publish is an owner login — handoff), **D38** (animated SVG stands in for the GIF), **D39** (Docker image is HTTP-transport-only and refuses to start without a token; ports/hosts documented), **D40** (MCPB bundle is built in CI from the tagged commit; unsigned).
- Spec status table: Phase 5 → released, Phase 6 → done. Commit, push, draft PR, CI, merge into develop, then develop→main PR (no npm publish happens: version unchanged; the Docker workflow triggers only on tags — trigger it once manually via `workflow_dispatch` after merge to build the `v0.1.0` image, and upload the MCPB to the existing v0.1.0 release by running the same steps locally with `gh release upload`).

**Acceptance:** all files present and validated; `main` carries the launch kit; v0.1.0 release has the `.mcpb` asset; ghcr image published; forum post final; handoff doc lists the two owner logins (Registry, Smithery).
