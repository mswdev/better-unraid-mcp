<div align="center">

# Better Unraid MCP

**Monitor and manage your Unraid server through natural language, from any MCP client.**

[![npm version](https://img.shields.io/npm/v/better-unraid-mcp)](https://www.npmjs.com/package/better-unraid-mcp)
[![CI](https://github.com/mswdev/better-unraid-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mswdev/better-unraid-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

</div>

Better Unraid MCP is a [Model Context Protocol](https://modelcontextprotocol.io) server for the [Unraid](https://unraid.net) GraphQL API. Connect it to Claude Desktop, Claude Code, Codex, Gemini CLI, or any other MCP client and ask things like *"why is my array degraded?"*, *"tail the syslog"*, or *"restart the Plex container"*.

## Features

Ask a plain question and get a real answer from your server. "Why is my array degraded?" becomes calls to `array_status` and `disk_list`, and you get back which disk is unhappy and what SMART thinks of it, without opening an SSH session or digging through WebGUI tabs.

The 35 tools cover most of what you would normally do over SSH or in the WebGUI:

- Diagnose problems in one conversation: unread alerts, CPU and memory pressure, network errors, disk temperatures, SMART health
- Read any log on the server: list them all, tail the syslog, or page through the middle of a huge file
- Manage Docker: container status and logs, per-container resource usage, start and stop, image updates, port conflict detection, boot autostart order
- Control VMs through libvirt, from a graceful shutdown to a hard reset
- Run the array: start or stop it, manage parity checks, review parity history, check the mover
- Triage notifications: read, archive, and clear the alerts you have been putting off
- Watch the UPS during an outage: battery charge, runtime estimate, load
- Go past the API when you need to (optional, via SSH): read any file on the host, such as `/boot/logs/syslog-previous`, or run a confirmed one-off command

The tools are deliberately paranoid. Destructive ones refuse to run unless the request includes `confirm: true`, so a stray sentence in a chat cannot stop your array, and the genuinely dangerous operations (stopping the array, hard-killing a VM) require a second `acknowledge_risk` flag on top. Every read works with a viewer-level API key.

There is nothing to install on the server itself. The MCP server runs on your machine, talks to Unraid's built-in GraphQL API with a single key, and starts with one `npx` command.

## Quick start

### 1. Create an Unraid API key

On your Unraid server (7.2 or newer), go to **Settings > Management Access > API Keys** and create a key. Or from the Unraid terminal:

```bash
unraid-api apikey --create
```

The key grants control of your server, so treat it like a password and scope it to the least privilege you need. A viewer-level key is enough for every read-only tool.

### 2. Add the server to your MCP client

**Claude Code**

```bash
claude mcp add better-unraid \
  -e UNRAID_API_URL=https://tower.local/graphql \
  -e UNRAID_API_KEY=your-api-key \
  -- npx -y better-unraid-mcp@latest
```

<details>
<summary><strong>Claude Desktop</strong></summary>

Add an entry to the `mcpServers` object in your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "better-unraid": {
      "command": "npx",
      "args": ["-y", "better-unraid-mcp@latest"],
      "env": {
        "UNRAID_API_URL": "https://tower.local/graphql",
        "UNRAID_API_KEY": "your-api-key"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Codex</strong></summary>

```bash
codex mcp add better-unraid \
  --env UNRAID_API_URL=https://tower.local/graphql \
  --env UNRAID_API_KEY=your-api-key \
  -- npx -y better-unraid-mcp@latest
```

Or add a server table to `~/.codex/config.toml`:

```toml
[mcp_servers.better-unraid]
command = "npx"
args = ["-y", "better-unraid-mcp@latest"]
env = { UNRAID_API_URL = "https://tower.local/graphql", UNRAID_API_KEY = "your-api-key" }
```

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Add an entry to the `mcpServers` object in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "better-unraid": {
      "command": "npx",
      "args": ["-y", "better-unraid-mcp@latest"],
      "env": {
        "UNRAID_API_URL": "https://tower.local/graphql",
        "UNRAID_API_KEY": "your-api-key"
      }
    }
  }
}
```

</details>

If your server uses a self-signed TLS certificate on the LAN, also set `UNRAID_ALLOW_SELF_SIGNED=true`. Using `@latest` keeps you on the newest release; pin a version (for example `better-unraid-mcp@0.0.1`) if you prefer fully predictable behavior.

### 3. Try it

Ask your client:

> "What's the status of my Unraid array?"

## Tools

Read-only tools never change anything. Destructive tools always require `confirm: true`; without it they refuse and never touch your server.

### System and storage

| Tool | Type | Description |
| --- | --- | --- |
| `system_info` | read-only | OS, kernel, uptime, hostname, and CPU summary. |
| `array_status` | read-only | Array state, capacity, current parity-check status, and per-disk health. |
| `parity_history` | read-only | Recent parity checks (date, status, errors, speed). |
| `disk_list` | read-only | Physical disks with model, size, SMART status, temperature, and partitions. |
| `share_list` | read-only | User shares with usage; filter by name. |
| `mover_status` | read-only | Whether the mover (cache-to-array migration) is running, plus its schedule. |

### Array control

Both tools require an API key with the **ADMIN** role. They report that the request was issued; run `array_status` afterward to confirm the result.

| Tool | Type | Description |
| --- | --- | --- |
| `array_action` | destructive | Starts or stops the array. Stopping takes every share, container, and VM offline, so `stop` also requires `acknowledge_risk: true`. |
| `parity_check` | destructive | Starts (optionally correcting), pauses, resumes, or cancels a parity check. |

### Docker

| Tool | Type | Description |
| --- | --- | --- |
| `docker_container_list` | read-only | Containers with state, image, and update availability; filter by name. |
| `docker_container_logs` | read-only | Recent log lines for a container, with tail and time-based paging. |
| `docker_network_list` | read-only | Docker networks (driver, scope, IPv6/internal/attachable). |
| `docker_port_conflicts` | read-only | Container and LAN port conflicts. |
| `docker_stats` | read-only | Per-container CPU, memory, network, and block IO usage, hungriest first. Needs SSH configured (see Host shell). |
| `docker_container_action` | destructive | Start, stop, pause, or unpause a container. |
| `docker_container_remove` | destructive | Permanently deletes a container (irreversible); optionally deletes its image. Needs Unraid 7.3+. |
| `docker_container_update` | destructive | Pulls the latest image and recreates containers, by id or all with updates. Needs Unraid 7.3+. |
| `docker_autostart_set` | destructive | Sets which containers auto-start on boot, merge-safely preserving boot order. Needs Unraid 7.3+. |

### Virtual machines

| Tool | Type | Description |
| --- | --- | --- |
| `vm_list` | read-only | Virtual machines with run state; filter by name. |
| `vm_action` | destructive | Start, stop, pause, resume, forceStop, reboot, or reset a VM by name or id. `forceStop` and `reset` are ungraceful and also require `acknowledge_risk: true`. |

### Notifications

| Tool | Type | Description |
| --- | --- | --- |
| `notification_overview` | read-only | Unread and archived counts broken down by importance. |
| `notification_list` | read-only | Notifications by type (`unread` or `archive`) with paging; the source of truth for ids. |
| `notification_alerts` | read-only | Deduplicated unread warnings and alerts: the "needs attention now" view. |
| `notification_archive` | mutation | Archives or unarchives notifications (reversible, ungated). |
| `notification_create` | mutation | Creates a notification (ungated). |
| `notification_recalculate` | mutation | Re-syncs cached overview counts from disk (ungated). |
| `notification_delete` | destructive | Permanently deletes notifications (irreversible). |

### Observability

| Tool | Type | Description |
| --- | --- | --- |
| `log_list` | read-only | The server's log files with size and last-modified time. |
| `log_read` | read-only | Tails or windows a log file (default 100 lines, max 2000), with paging hints. |
| `system_metrics` | read-only | Point-in-time CPU load, memory pressure, per-interface network rates, and server time. Temperature data is opt-in. |

### Plugins

| Tool | Type | Description |
| --- | --- | --- |
| `plugin_list` | read-only | Installed API plugins and OS `.plg` plugins. |
| `plugin_add` | destructive | Installs API plugins by npm package name, then restarts the Unraid API. Running `npm install` on your server executes package lifecycle scripts, so only install packages you trust. |
| `plugin_remove` | destructive | Uninstalls API plugins by npm package name, then restarts the Unraid API. |

### UPS

| Tool | Type | Description |
| --- | --- | --- |
| `ups_status` | read-only | Live UPS telemetry from apcupsd: status (`ONLINE`, `ONBATT`, `LOWBATT`, ...), battery charge and runtime, and power load. Reports "no live UPS data" instead of a fabricated healthy reading when the API returns placeholder values. |

### Host shell (optional, needs SSH)

The GraphQL API cannot reach everything (old boot logs under `/boot/logs`, `/proc`, one-off commands). These tools close that gap over SSH. They are **off by default**: they activate only when you set the `UNRAID_SSH_*` variables (see Configuration), and without them they refuse with setup guidance. `docker_stats` above also uses this channel.

| Tool | Type | Description |
| --- | --- | --- |
| `file_read` | read-only | Tails any absolute file path on the host (default 200 lines, max 2000). Optional `pattern` greps server-side first, so searching huge logs stays cheap. |
| `shell_exec` | destructive | Runs an arbitrary command as the SSH user (typically root). Every call requires `confirm: true`; output is capped and timeouts are enforced (default 30s, max 120s). |

> **Note:** tool behavior is validated against the Unraid API v4.35.0 source and covered by 360+ unit tests, but has not yet been broadly exercised against live servers. Treat destructive tools with care and please [open an issue](https://github.com/mswdev/better-unraid-mcp/issues) if anything misbehaves.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `UNRAID_API_URL` | yes | | Full Unraid GraphQL endpoint, including `/graphql`. |
| `UNRAID_API_KEY` | yes | | API key from Quick start step 1. |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` (local clients) or `http` (remote clients). |
| `MCP_HTTP_PORT` | no | `3000` | Port for the `http` transport. |
| `MCP_HTTP_HOST` | no | `127.0.0.1` | Bind address for the `http` transport. |
| `MCP_HTTP_ALLOWED_HOSTS` | no | | Comma-separated `Host` allow-list; enables DNS-rebinding protection. |
| `UNRAID_ALLOW_SELF_SIGNED` | no | `false` | Set `true` only for a self-signed TLS certificate on the LAN. |
| `LOG_LEVEL` | no | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |
| `UNRAID_SSH_HOST` | no | | Enables the host-shell tools (`file_read`, `shell_exec`, `docker_stats`). Requires a password or key path. |
| `UNRAID_SSH_PORT` | no | `22` | SSH port. |
| `UNRAID_SSH_USER` | no | `root` | SSH user. Unraid administration is normally `root`. |
| `UNRAID_SSH_PASSWORD` | no | | SSH password. Prefer `UNRAID_SSH_KEY_PATH` where possible. |
| `UNRAID_SSH_KEY_PATH` | no | | Path to an SSH private key file (readable by the MCP server process). |

See [`.env.example`](.env.example) for a copy-paste template.

## Remote / HTTP transport

For remote or hosted clients, run over Streamable HTTP instead of stdio:

```bash
MCP_TRANSPORT=http \
UNRAID_API_URL=https://tower.local/graphql \
UNRAID_API_KEY=your-api-key \
npx -y better-unraid-mcp@latest
```

The MCP endpoint is then `POST http://host:3000/mcp`.

> **Warning:** the HTTP transport performs no authentication of inbound requests, and every request uses your privileged Unraid API key upstream. It binds to localhost by default. To expose it further (including to cloud clients such as ChatGPT connectors), put it behind a reverse proxy that adds authentication and TLS, and set `MCP_HTTP_ALLOWED_HOSTS`. Never expose the raw endpoint to an untrusted network.

## Security

The Unraid API key grants control of your server. Scope it to the least privilege you need, store it only in environment variables or your client's secret store, and never commit it to version control.

## Development

```bash
git clone https://github.com/mswdev/better-unraid-mcp.git
cd better-unraid-mcp
npm install
npm run build      # or: npm run dev
```

Run the quality gate before every commit:

```bash
npm run typecheck && npm run build && npm test && npm run lint
```

Contributions: branch off `develop`, one logical change per commit (conventional commits), and open a draft PR into `develop`. The vendored schema (`schema/unraid.graphql`) and generated types (`src/types/unraid/**`) are never hand-edited; refresh them with `npm run schema:update` and `npm run generate`.

## License

[MIT](LICENSE)
