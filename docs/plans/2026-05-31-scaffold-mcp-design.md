# better-unraid-mcp — Scaffold Design (PR #1)

**Date:** 2026-05-31
**Author:** Matt White (mswdev)
**Status:** Approved — ready for implementation planning
**Branch:** `feature/scaffold-mcp` → draft PR into `develop`

## Goal

Stand up `better-unraid-mcp`: a public, community-maintainable Model Context
Protocol server that will eventually expose the **full** Unraid GraphQL API.
The differentiators over existing Unraid MCPs (e.g. `jmagar/unraid-mcp`, a
Python single-mega-tool project) are: complete API coverage over time,
TypeScript with `npx` distribution so it works in every MCP client, and a
maintained agent-assisted contribution workflow.

This PR delivers **only the scaffold** — the framework plus one working
proof-of-concept tool. The rest of the API surface is explicitly future work.

## Key research findings (drove the design)

- **The Unraid API is GraphQL, not REST.** Endpoint `http://SERVER/graphql`,
  auth via `x-api-key` header (keys created in Settings → Management Access →
  API Keys, or `unraid-api apikey --create`). This is the one change from the
  reference Mealie stack: `openapi-typescript` (REST/OpenAPI) is replaced by
  GraphQL Code Generator.
- **The schema is vendorable.** Unraid commits a `generated-schema.graphql`
  SDL (~3,700 lines) to their open-source monorepo
  (`unraid/api`, `api/generated-schema.graphql`). We commit that SDL into our
  repo and run codegen offline / in CI — mirroring how the Mealie MCP commits
  its generated types. No live server is needed to build.
- **Tool-design consensus (Anthropic + 2025–26 MCP community).** Two anti-
  patterns to avoid: (1) one discrete tool per API endpoint → context bloat
  (GitHub's MCP = 93 tools ≈ 55k tokens before the first user message);
  (2) one opaque mega-tool with an action enum (jmagar's `unraid` with ~80
  subactions) → the model can't see what's available. The recommended middle
  path, adopted here:
  1. **Consolidate around workflows, not endpoints** (e.g. `get_system_info`
     returns OS + CPU + uptime in one call, not three field-level tools).
  2. **Namespace tools by resource** (`system_*`, `docker_*`, `vm_*`,
     `array_*`, `share_*`, …).
  3. **Search/filter over list-all** and **concise-by-default responses** with
     an optional `response_format: concise | detailed` parameter.
  4. **MCP tool annotations** (`readOnlyHint`, `destructiveHint`) plus an
     **explicit-confirm gate** for destructive operations.
  - Sources: Anthropic, *Writing effective tools for agents*; Anthropic,
    *Code execution with MCP*; *Reducing MCP token bloat* (The New Stack).
  - Progressive disclosure / code-execution mode is the heavyweight answer for
    very large surfaces; documented as a **future scaling lever**, not built
    now (YAGNI).

## Scope

**In this PR**

- Agent kit ported from `mswdev/llm-agent-kit` and customized for Unraid.
- MCP server framework: stdio + Streamable HTTP transports, zod-validated env,
  typed GraphQL client, self-registering domain-organized tool registry, and
  the cross-cutting conventions (namespacing, concise output, annotations,
  confirm-gate helper) baked in from tool #1.
- GraphQL type-generation pipeline (vendored SDL + graphql-codegen).
- **One** read-only PoC tool: `get_system_info`.
- CI workflow + npm distribution config + README with per-client install docs.

**Out of scope (future PRs)**

- The rest of the Unraid API (docker, vm, array/parity, disks, shares,
  notifications, rclone, UPS, plugins, API-key mgmt, OIDC/SSO…).
- GraphQL subscriptions / live WebSocket telemetry.
- MCPB bundle (Claude Desktop one-click), Claude Code plugin wrapper.
- Progressive-disclosure / code-execution tool mode.

## Distribution model (decided)

Standalone npm MCP server, run via `npx better-unraid-mcp`. A plain MCP server
is the only model that satisfies "anyone can use it" — Claude Code, Claude
Desktop, Codex, Gemini, ChatGPT connectors. A Claude Code *plugin* is a
Claude-Code-only concept and would exclude every other client, so it is at most
an optional thin wrapper in a later PR — never the core.

## Tech stack

Same as the Mealie MCP except the type-gen swap:

- **Language/runtime:** TypeScript 5 (strict, ESM / NodeNext), Node ≥ 20,
  `"type": "module"`.
- **MCP core:** `@modelcontextprotocol/sdk` (McpServer; stdio + Streamable HTTP
  transports), `zod` (tool input schemas + env validation).
- **Runtime libs:** `pino` (structured logging, stderr only), native `fetch`
  (no HTTP-client dependency).
- **Type generation:** `@graphql-codegen/cli` + `@graphql-codegen/client-preset`
  (devDeps) generate typed documents/types from the vendored SDL;
  `@graphql-typed-document-node/core` (type-only) ties documents to results.
  **Net new runtime deps over Mealie: zero** (still native fetch).
- **Build/dev:** `tsup` (single executable `dist/index.js`, ESM, node20,
  shebang), `tsx` (run the generation script), `@biomejs/biome` (lint + format).
- **Testing:** `vitest` (hermetic; hand-written fakes; no network).

## Project structure

```
schema/unraid.graphql            # vendored SDL from unraid/api (committed, banner)
codegen.ts                       # graphql-codegen config
src/
  index.ts                       # entry: load env, pick transport, start
  server.ts                      # builds McpServer, runs tool registry
  config/env.ts                  # zod env schema + validation
  graphql/
    client.ts                    # UnraidClient: fetch → /graphql, x-api-key, errors
    execute.ts                   # typed execute(TypedDocumentNode, vars)
  tools/
    registry.ts                  # discovers + registers all tool modules
    _shared/respond.ts           # response_format (concise|detailed) helper
    _shared/confirm.ts           # destructive-op confirm-gate helper (stub)
    system/get-system-info.ts    # PoC tool (+ colocated .test.ts)
  types/unraid/                  # generated (committed, banner-marked)
```

Top-level `src/` directories are organized by architectural layer (allowed by
the file-organization rules). `tools/` groups by **domain** (`system/`, later
`docker/`, `vm/`…), which satisfies both the ≤10-files-per-directory cap and the
resource-namespacing recommendation. `_shared/` holds cross-cutting tool helpers
at the common ancestor.

## MCP server behavior

- **Transports:** stdio (default — covers every local client talking to a LAN
  Unraid box) and Streamable HTTP, selected by env (`MCP_TRANSPORT`, `PORT`).
- **Config (zod-validated at startup, fail fast):**
  - `UNRAID_API_URL` — full GraphQL endpoint, e.g. `https://tower.local/graphql`.
  - `UNRAID_API_KEY` — passed as `x-api-key`; never logged.
  - `MCP_TRANSPORT` — `stdio` (default) | `http`; `PORT` for http.
  - `UNRAID_ALLOW_SELF_SIGNED` — Unraid commonly serves self-signed /
    `*.myunraid.net` certs on the LAN; this opt-in relaxes TLS verification.
  - `LOG_LEVEL`.
- **GraphQL client:** native fetch POST with `x-api-key`; typed by codegen
  documents; maps GraphQL/HTTP/network errors to clean MCP tool errors; never
  logs the key.
- **PoC tool `get_system_info`:** read-only (`readOnlyHint: true`). Queries
  `info { os { platform distro release uptime } cpu { manufacturer brand cores
  threads } }`. Concise-by-default output with optional `response_format`.
  Proves the full chain: env → client → typed query → tool registration →
  annotations → response shaping.

## Type-generation pipeline

- `schema/unraid.graphql` is committed (banner-marked as vendored).
- `npm run generate` runs graphql-codegen against the committed SDL + our
  operation documents → `src/types/unraid/` (committed, banner-marked). Offline
  and CI-safe; no live server required.
- `npm run schema:update` re-pulls the SDL from `unraid/api` when Unraid ships
  schema changes (the only step that touches the network, run by maintainers).

## Agent kit port

**Bring over:** `.claude/CLAUDE.md`, all four `.claude/rules/*.md`, `AGENTS.md`
(symlink → `.claude/CLAUDE.md`), `.github/workflows/{claude,claude-review,
openai-assistant,openai-review}.yml`, `.github/actions/claude-stats/`,
`.github/prompts/review.md`.

**Drop:** `.claude/tailwind-plus-components.md` and the entire §6
Figma-to-Code section of `CLAUDE.md` (no frontend in an MCP).

**Customize:**
- `CLAUDE.md` — fill placeholders: owner = Matt White / mswdev; product =
  Unraid MCP; Project Overview with an Unraid domain-terms table (array,
  parity, share, cache pool, mover, Docker, VM); Infrastructure table (Unraid
  GraphQL API, npm registry, GitHub Actions); linting = Biome; git workflow =
  feature branch off `develop` → draft PR into `develop`.
- `rules/security.md` — remove "monetary values in cents" (irrelevant); add
  Unraid no-touch zones: never hand-edit generated types or the vendored
  schema, never log the API key, never run destructive GraphQL mutations
  without the confirm gate.
- `rules/code-style.md` — set linting = Biome.
- `.github/prompts/review.md` — leave package-specific rules section empty for
  now.

## CI (one addition beyond the kit)

Add `.github/workflows/ci.yml` running `npm run build && npm test && npm run
lint` (and verifying committed codegen output is up to date) on push / PR. The
kit ships assistant + review workflows but no plain CI gate; a publishable npm
package needs one.

## Distribution & README

- `package.json`: name `better-unraid-mcp` (verify npm availability before
  publish), `bin → dist/index.js`, `files: ["dist", "schema"]`, `engines.node
  >= 20`, `prepare` + `prepublishOnly` gates (build + test + lint).
- README: `npx better-unraid-mcp` usage, env-var reference, and copy-paste
  config blocks for Claude Desktop, Claude Code (`claude mcp add`), Codex, and
  Gemini.
- **ChatGPT caveat (documented, not over-promised):** ChatGPT connectors need
  the MCP server reachable from OpenAI's cloud. A LAN Unraid box is not, without
  the user self-hosting / tunneling the HTTP transport. stdio + HTTP still ship
  regardless; the README states the deployment requirement plainly.

## Testing & quality gate

`vitest`, hermetic, with a hand-written fake of the GraphQL transport (no
network). Cover: PoC tool maps a fake `info` response → concise output; env
validation rejects bad config; confirm-gate helper behaves. Quality gate:
`npm run build && npm test && npm run lint`.

## Future direction (not this PR)

Grow the resource-namespaced tool set onto this scaffold one domain at a time
(docker, vm, array, shares, notifications, …). Add subscriptions/live telemetry,
an MCPB bundle and Claude Code plugin wrapper as optional distribution layers,
and adopt progressive disclosure / code-execution mode if/when tool count makes
context cost a real problem.
```
