# better-unraid-mcp

A complete, maintained [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the [Unraid](https://unraid.net) GraphQL API. It exposes your Unraid server's data and operations as MCP tools so any MCP-capable client — Claude Desktop, Claude Code, Codex, Gemini CLI, and others — can read and manage your server through natural language.

## Status

This is an early scaffold: the full server framework, the GraphQL type-generation pipeline, and one read-only proof-of-concept tool (`system_info`) are in place. Full coverage of the Unraid API surface (array, shares, Docker, VMs, and more) is in progress and will land in subsequent releases.

## Requirements

- An Unraid server running **7.2+** (or an older release with the Unraid Connect plugin that ships the GraphQL API).
- An **Unraid API key** (see [Get an API key](#get-an-api-key)).
- **Node.js ≥ 20** — only needed if you run from source. Running via `npx` requires nothing beyond Node being installed.

## Get an API key

Create an API key on your Unraid server in one of two ways:

- **Web UI:** **Settings → Management Access → API Keys**, then create a key.
- **CLI** (on the Unraid box):

  ```bash
  unraid-api apikey --create
  ```

The API key grants control of your server — treat it like a password (see [Security](#security)).

## Install / run

No install step is required. Run the server directly with `npx`, providing your server's GraphQL endpoint and API key as environment variables:

```bash
UNRAID_API_URL=https://tower.local/graphql \
UNRAID_API_KEY=your-api-key \
npx -y better-unraid-mcp
```

### Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `UNRAID_API_URL` | yes | — | Full Unraid GraphQL endpoint, including `/graphql`. |
| `UNRAID_API_KEY` | yes | — | API key created above. |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` (local clients) or `http` (remote/hosted clients). |
| `MCP_HTTP_PORT` | no | `3000` | Port for the `http` transport. |
| `MCP_HTTP_HOST` | no | `127.0.0.1` | Bind address for the `http` transport. Defaults to localhost; set `0.0.0.0` to expose it (e.g. in Docker) — only behind authentication. |
| `MCP_HTTP_ALLOWED_HOSTS` | no | — | Comma-separated `Host` allow-list. When set, enables DNS-rebinding protection (only the listed hosts are accepted). |
| `UNRAID_ALLOW_SELF_SIGNED` | no | `false` | Set `true` only if your server uses a self-signed TLS cert on the LAN. |
| `LOG_LEVEL` | no | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |

See [`.env.example`](.env.example) for a copy-paste template.

## Client configuration

### Claude Desktop

Add an entry to the `mcpServers` object in your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "better-unraid": {
      "command": "npx",
      "args": ["-y", "better-unraid-mcp"],
      "env": {
        "UNRAID_API_URL": "https://tower.local/graphql",
        "UNRAID_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

Add the server with `claude mcp add`:

```bash
claude mcp add better-unraid -- npx -y better-unraid-mcp
```

Pass environment variables with `-e` (repeat for each variable):

```bash
claude mcp add better-unraid \
  -e UNRAID_API_URL=https://tower.local/graphql \
  -e UNRAID_API_KEY=your-api-key \
  -- npx -y better-unraid-mcp
```

### Codex

Add a server table to `~/.codex/config.toml`:

```toml
[mcp_servers.better-unraid]
command = "npx"
args = ["-y", "better-unraid-mcp"]
env = { UNRAID_API_URL = "https://tower.local/graphql", UNRAID_API_KEY = "your-api-key" }
```

Or add it from the CLI:

```bash
codex mcp add better-unraid \
  --env UNRAID_API_URL=https://tower.local/graphql \
  --env UNRAID_API_KEY=your-api-key \
  -- npx -y better-unraid-mcp
```

### Gemini CLI

Add an entry to the `mcpServers` object in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "better-unraid": {
      "command": "npx",
      "args": ["-y", "better-unraid-mcp"],
      "env": {
        "UNRAID_API_URL": "https://tower.local/graphql",
        "UNRAID_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Remote / HTTP transport

For hosted or remote clients, run the server over the stateless Streamable HTTP transport instead of stdio:

```bash
MCP_TRANSPORT=http \
MCP_HTTP_PORT=3000 \
UNRAID_API_URL=https://tower.local/graphql \
UNRAID_API_KEY=your-api-key \
npx -y better-unraid-mcp
```

The MCP endpoint is then `POST http://host:3000/mcp`.

> **Security of the HTTP transport.** By default the server binds to
> `127.0.0.1` (localhost only) and performs **no authentication** of inbound
> requests — anyone who can reach the endpoint can invoke its tools, and the
> server uses your privileged Unraid API key for every upstream call. To expose
> it beyond localhost (e.g. in Docker, set `MCP_HTTP_HOST=0.0.0.0`), put it
> behind a reverse proxy that adds authentication and TLS, and set
> `MCP_HTTP_ALLOWED_HOSTS` to enable DNS-rebinding protection. Do not expose the
> raw endpoint directly to an untrusted network.

## ChatGPT caveat

ChatGPT connectors require the MCP server to be reachable from OpenAI's cloud. A LAN-only Unraid box is **not** reachable from the cloud. To use this server with ChatGPT you must self-host or tunnel the HTTP transport yourself — for example behind a reverse proxy with authentication — and make it reachable from the internet.

Both `stdio` and `http` transports ship with this server. Cloud reachability, TLS termination, and access control for a hosted deployment are your responsibility; this project does not provide a hosted endpoint.

## Security

The Unraid API key grants control of your server. Scope it to the least privilege you need, store it only in environment variables or your client's secret store, and **never commit it** to version control. The `.gitignore` excludes `.env*` (except `.env.example`) for this reason.

## Development

```bash
git clone https://github.com/mswdev/better-unraid-mcp.git
cd better-unraid-mcp
npm install
npm run generate   # regenerate typed GraphQL documents from the vendored SDL
```

Run the quality gate before every commit:

```bash
npm run typecheck && npm run build && npm test && npm run lint
```

### Contributing

Branch off `develop`, make one logical change per commit (conventional commits), and open a **draft** PR into `develop`. Never commit to `main` or `develop` directly. The vendored schema (`schema/unraid.graphql`) and generated types (`src/types/unraid/**`) are never hand-edited — refresh them with `npm run schema:update` and `npm run generate`.

## License

[MIT](LICENSE)
