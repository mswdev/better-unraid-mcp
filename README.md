# better-unraid-mcp

A complete, maintained [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the [Unraid](https://unraid.net) GraphQL API. It exposes your Unraid server's data and operations as MCP tools so any MCP-capable client — Claude Desktop, Claude Code, Codex, Gemini CLI, and others — can read and manage your server through natural language.

## Status

This is an early but growing server: the full server framework, the GraphQL type-generation pipeline, the read-only system & storage tools, the Docker tools (reads plus confirm-gated mutations), the VM tools (a read plus a confirm-gated mutation), and the notification tools (reads plus three ungated and one confirm-gated mutation) are in place. Full coverage of the Unraid API surface is in progress and will land in subsequent releases.

### Available tools

#### System & storage

These tools are all **read-only**.

| Tool | Description |
| --- | --- |
| `system_info` | Returns the Unraid server's OS, distro, release, kernel, uptime, hostname, and a CPU summary. |
| `array_status` | Returns the array state, capacity, current parity-check status, and a per-disk health summary (data, parity, and cache disks). |
| `parity_history` | Returns the most recent parity checks (date, status, errors, speed); `limit` controls how many are returned. |
| `disk_list` | Lists physical disks with model, size, interface, SMART status, temperature, and partitions. |
| `share_list` | Lists user shares with usage (free/used/total); `name` filters by a share-name substring. |

#### Docker

Four read-only tools and four **destructive** mutations. Every mutation requires `confirm: true` — without it the tool refuses and never touches your server.

| Tool | Type | Description |
| --- | --- | --- |
| `docker_container_list` | read-only | Lists Docker containers with state, image, and whether an update is available; `name` filters by a container-name substring. |
| `docker_container_logs` | read-only | Returns recent log lines for a container. `id` is the container id from `docker_container_list`; `tail` sets trailing lines (default 200, max 2000); `since` is an inclusive ISO-8601 lower bound (re-pass the returned `cursor` to page). |
| `docker_network_list` | read-only | Lists Docker networks (driver, scope, IPv6/internal/attachable). |
| `docker_port_conflicts` | read-only | Reports Docker container/LAN port conflicts. |
| `docker_container_action` | **destructive** | Changes a container's run state — `action` is one of `start`, `stop`, `pause`, `unpause`. Requires `confirm: true`. |
| `docker_container_remove` | **destructive** | Permanently deletes a container (force-kills it if running; irreversible). `with_image: true` also attempts a best-effort image delete. Requires `confirm: true`. Needs Unraid OS **7.3+**. |
| `docker_container_update` | **destructive** | Pulls the latest image(s) and recreates container(s). Provide either `ids` (specific containers) or `all: true` (every container with an available update) — not both. Requires `confirm: true`. Needs Unraid OS **7.3+**. |
| `docker_autostart_set` | **destructive** | Sets which containers auto-start on boot (merge-safe; resubmits the full set sorted to preserve boot order). Boot-time only. `persist: true` also updates the WebGUI prefs but reorders the Docker-page list irreversibly. Requires `confirm: true`. Needs Unraid OS **7.3+**. |

> **Not yet verified against a live Unraid server.** The Docker tools are covered by hermetic unit tests but have **not** been exercised against a running Unraid box. `docker_container_remove`, `docker_container_update`, and `docker_autostart_set` require **Unraid OS 7.3+**. `docker_network_list` and `docker_port_conflicts` are designed strictly to the vendored GraphQL SDL — their runtime behavior is unverified. Treat the destructive Docker tools with care.

#### Virtual machines

One read-only tool and one **destructive** mutation. The mutation requires `confirm: true` — without it the tool refuses and never touches your server.

| Tool | Type | Description |
| --- | --- | --- |
| `vm_list` | read-only | Lists virtual machines with their run state (`RUNNING`, `SHUTOFF`, `PAUSED`, …); `name` filters by a VM-name substring. |
| `vm_action` | **destructive** | Changes a VM's run state — `action` is one of `start`, `stop`, `pause`, `resume`, `forceStop`, `reboot`, `reset`. `vm` accepts a VM name or id. Requires `confirm: true`; `forceStop` and `reset` additionally require `acknowledge_risk: true` (an ungraceful hard kill that can corrupt the guest filesystem). |

> **Not yet verified against a live Unraid server.** Like the Docker tools, the VM tools are covered by hermetic unit tests but have **not** been exercised against a running Unraid box. The configured Unraid API key must have VM permission. Treat `vm_action` — especially `forceStop` and `reset` — with care.

#### Notifications

Three read-only tools and four mutations. `notification_delete` is **destructive** and requires `confirm: true` — without it the tool refuses and never touches your server; the other three mutations are reversible or non-destructive and ungated.

| Tool | Type | Description |
| --- | --- | --- |
| `notification_overview` | read-only | Returns notification counts: unread and archived, each broken down by importance (alert / warning / info) plus total. |
| `notification_list` | read-only | Lists notifications of one `type` (`unread` or `archive`), newest first; optional `importance` filter, with `offset`/`limit` paging. The source of truth for which notifications exist and their ids. |
| `notification_alerts` | read-only | Returns the deduplicated unread warnings and alerts, newest first — the "needs attention now" view. |
| `notification_archive` | mutation | Archives (hides) or unarchives (restores to unread) notifications — reversible. Targets specific `ids` or `all: true` (optionally one `importance`). Ungated. |
| `notification_create` | mutation | Creates a notification (`mode: always` or `if_unique`). Ungated. |
| `notification_recalculate` | mutation | Re-syncs the cached overview counts from disk. Ungated. |
| `notification_delete` | **destructive** | Permanently deletes notifications (irreversible). `scope`: `one` (needs `id` and its `type`) or `all_archived`. Requires `confirm: true`. |

> **Counts come from a cache.** The overview counts read by `notification_overview` (and echoed by some mutations) are served from a cache that can lag; `notification_list` is the source of truth for which notifications exist and their ids. Use `notification_recalculate` to re-sync the overview if it drifts.

> **Not yet verified against a live Unraid server.** Like the Docker and VM tools, the notification tools are covered by hermetic unit tests but have **not** been exercised against a running Unraid box. Treat `notification_delete` with care.

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
