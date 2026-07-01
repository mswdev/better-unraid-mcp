# better-unraid-mcp

A complete, maintained [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for the [Unraid](https://unraid.net) GraphQL API. It exposes your Unraid server's data and operations as MCP tools so any MCP-capable client — Claude Desktop, Claude Code, Codex, Gemini CLI, and others — can read and manage your server through natural language.

## Status

This is an early but growing server: the full server framework, the GraphQL type-generation pipeline, the read-only system & storage tools, the array-control tools (confirm-gated array power and parity-check mutations), the Docker tools (reads plus confirm-gated mutations), the VM tools (a read plus a confirm-gated mutation), the notification tools (reads plus three ungated and one confirm-gated mutation), the observability tools (read-only log inventory/windowing plus a system-metrics snapshot), the plugin tools (a read plus two confirm-gated lifecycle mutations), and the read-only UPS tool (live power/battery telemetry) are in place. Full coverage of the Unraid API surface is in progress and will land in subsequent releases.

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

#### Array control

Two **destructive** mutations. Both require `confirm: true` — without it the tool refuses and never touches your server.

| Tool | Type | Description |
| --- | --- | --- |
| `array_action` | **destructive** | Starts or stops the array behind a confirm gate (stop also requires `acknowledge_risk` — Unraid takes every share, Docker container, and VM offline). Reports the request; run `array_status` to confirm. |
| `parity_check` | **destructive** | Starts (optionally `correct`ing), pauses, resumes, or cancels a parity check behind a confirm gate. Reports the request; run `array_status` to confirm. |

> **Not yet verified against a live Unraid server.** The array-control tools are covered by hermetic unit tests and validated against the Unraid API v4.35.0 source, but have **not** been exercised against a running Unraid box. Both require an Unraid API key with the **ADMIN** role. The mutations cannot report the resulting state — run `array_status` after each call to confirm. Treat `array_action` — especially `stop` — with care.

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
| `notification_alerts` | read-only | Returns the deduplicated unread warnings and alerts, newest first — the "needs attention now" view (up to 50). |
| `notification_archive` | mutation | Archives (hides) or unarchives (restores to unread) notifications — reversible. Targets specific `ids` or `all: true` (optionally one `importance`). Ungated. |
| `notification_create` | mutation | Creates a notification (`mode: always` or `if_unique`). Ungated. |
| `notification_recalculate` | mutation | Re-syncs the cached overview counts from disk. Ungated. |
| `notification_delete` | **destructive** | Permanently deletes notifications (irreversible). `scope`: `one` (needs `id` and its `type`) or `all_archived`. Requires `confirm: true`. |

> **Counts come from a cache.** The overview counts read by `notification_overview` (and echoed by some mutations) are served from a cache that can lag; `notification_list` is the source of truth for which notifications exist and their ids. `notification_recalculate` re-syncs the cached overview from disk, but `notification_list` remains the authority — recalculated counts can still differ on installs where a notification was written to both the unread and archive folders.

> **Not yet verified against a live Unraid server.** Like the Docker and VM tools, the notification tools are covered by hermetic unit tests but have **not** been exercised against a running Unraid box. Treat `notification_delete` with care.

#### Observability

These tools are all **read-only**.

| Tool | Description |
| --- | --- |
| `log_list` | Lists the server's log files (name, path, size, last modified), most recently modified first. An empty list may also mean the log directory was unreadable — the API does not distinguish. Needs a viewer-level key (LOGS read). |
| `log_read` | Returns lines from a log file. `path` is a path or name from `log_list`, validated against that list before reading. Tail by default (`lines` default 100, max 2000); `start_line` (1-indexed) windows from there, and re-call with the hinted values to page. Needs a viewer-level key (LOGS read). |
| `system_metrics` | Point-in-time snapshot: CPU load, memory pressure (percent + available bytes), per-interface network rates/errors, and server time (timezone, NTP). `include_temperature=true` adds sensor data (may take seconds on multi-disk servers). Needs a viewer-level key (INFO+VARS read). |

> **Not yet verified against a live Unraid server.** Like the other tool groups, the observability tools are covered by hermetic unit tests but have **not** been exercised against a running Unraid box.

#### Plugins

One read-only tool and two mutations. `plugin_add` and `plugin_remove` are **destructive** and each require `confirm: true` — without it the tool refuses and never touches your server.

| Tool | Type | Description |
| --- | --- | --- |
| `plugin_list` | read-only | Lists installed plugins: the API's active/loaded `plugins` (a boot snapshot that changes only after an API restart) and the live OS `.plg` filenames. An empty list is **not** a definitive zero — it can also mean safe mode (api plugins) or an unreadable plugin directory (OS `.plg`). Needs CONFIG read (any viewer-level key). |
| `plugin_add` | **destructive** | ⚠ Installs api plugins by npm package name (`names`). Runs `npm install`, which executes the package's lifecycle scripts on the server (supply-chain / code-execution risk), then **restarts the Unraid API** to load them — your connection drops briefly. `names` must be bare or scoped package names (no URLs, git refs, paths, or version suffixes). Requires `confirm: true` and CONFIG write (UPDATE_ANY). Reports submission; verify with `plugin_list` after reconnect. |
| `plugin_remove` | **destructive** | ⚠ Uninstalls api plugins by npm package name (`names`, as shown by `plugin_list`) and **restarts the Unraid API** to unload them — your connection drops briefly. Only plugins currently in the API config are affected (unknown names are a no-op). Requires `confirm: true` and CONFIG write (DELETE_ANY). Reports submission; verify with `plugin_list` after reconnect. |

> **Not yet verified against a live Unraid server.** Like the other tool groups, the plugin tools are covered by hermetic unit tests but have **not** been exercised against a running Unraid box. Treat `plugin_add` and `plugin_remove` with care.

#### UPS

This tool is **read-only**.

| Tool | Description |
| --- | --- |
| `ups_status` | Live UPS telemetry from apcupsd: operational status (passed through verbatim from apcaccess — e.g. `ONLINE`, `ONBATT`, `LOWBATT`, `COMMLOST`), battery charge and estimated runtime, and power load/voltage. An error usually means no UPS is attached or apcupsd is not running. When the API returns placeholder values for an absent UPS, the tool reports **"no live UPS data"** rather than a fabricated healthy reading — but a real alert status is always surfaced. Reachable by any authenticated key (no special permission). |

> **Not yet verified against a live Unraid server.** Like the other tool groups, the UPS tool is covered by hermetic unit tests but has **not** been exercised against a running Unraid box.

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
