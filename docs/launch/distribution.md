# Distribution channels — owner handoff (0.1.0)

Everything below is prepared in the repo; the two items marked **owner login** need an interactive sign-in that the autonomous run could not perform.

## npm (live)
`npx -y better-unraid-mcp@latest` — published automatically by `release.yml` on every version bump merged to `main`.

## Official MCP Registry — **owner login**
- `package.json` carries `"mcpName": "io.github.mswdev/better-unraid-mcp"` (published in 0.1.0) and `server.json` describes the npm package (schema 2025-12-11).
- Publish (once per version; bump `version` in `server.json` alongside `package.json`):
  ```bash
  brew install mcp-publisher            # macOS/Linux
  mcp-publisher login github            # interactive device flow, proves the io.github.mswdev namespace
  mcp-publisher publish                 # reads ./server.json
  ```
- Verify: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=better-unraid"`.

## Claude Code plugin marketplace (live from the repo)
```bash
claude plugin marketplace add mswdev/better-unraid-mcp
claude plugin install better-unraid@better-unraid-mcp
```
Marketplace: `.claude-plugin/marketplace.json`; plugin: `plugins/better-unraid/` (`.mcp.json` runs `npx -y better-unraid-mcp@latest`, credentials from the environment).

## Claude Desktop one-click bundle (.mcpb)
- `release.yml` builds `better-unraid-mcp-<version>.mcpb` (`npm run build:mcpb`) and attaches it to the GitHub Release. Users download it and double-click; Claude Desktop prompts for the URL/API key (the `user_config` in `manifest.json`).
- Local build: `npm run build && npm run build:mcpb` → `build/*.mcpb`.

## Smithery — **owner login**
```bash
npx -y @smithery/cli@latest login
npx -y @smithery/cli@latest mcp publish ./build/better-unraid-mcp-0.1.0.mcpb -n mswdev/better-unraid-mcp
```

## Docker image (ghcr.io)
`docker.yml` publishes `ghcr.io/mswdev/better-unraid-mcp:<version>` and `:latest` on every `v*` tag (and via *Run workflow* with a tag). HTTP transport only; see README → Docker for the compose snippet. The first run for `v0.1.0` must be triggered manually (the tag existed before the workflow).

## Forum post
Final text: `docs/launch/forum-post.md` — post to the Unraid forums (General Support or Plugin Support) after the Docker image and MCPB asset exist.
