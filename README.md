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

The 37 tools cover most of what you would normally do over SSH or in the WebGUI:

- Diagnose problems in one conversation: unread alerts, CPU and memory pressure, network errors, disk temperatures, SMART health
- Read any log on the server: list them all, tail the syslog, or page through the middle of a huge file
- Manage Docker: container status and logs, per-container resource usage, start and stop, image updates, port conflict detection, boot autostart order
- Control VMs through libvirt, from a graceful shutdown to a hard reset
- Run the array: start or stop it, manage parity checks, review parity history, check the mover
- Triage notifications: read, archive, and clear the alerts you have been putting off
- Watch the UPS during an outage: battery charge, runtime estimate, load
- Go past the API when you need to (optional, via SSH): read any file on the host, such as `/boot/logs/syslog-previous`, or run a confirmed one-off command
- Reach the rest of the API surface with raw `graphql_query` and confirm-gated `graphql_mutation`, so nothing is off limits while dedicated tools catch up

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

If your server uses a self-signed TLS certificate on the LAN, also set `UNRAID_ALLOW_SELF_SIGNED=true`. To enable the optional host-shell tools (reading files like `/boot/logs/syslog-previous`, running commands, per-container stats), also pass the `UNRAID_SSH_*` variables described under [Configuration](#configuration). Using `@latest` keeps you on the newest release; pin a version (for example `better-unraid-mcp@0.0.1`) if you prefer fully predictable behavior.

### 3. Try it

Ask your client:

> "What's the status of my Unraid array?"

## Tools

Read-only tools never change anything. Destructive tools always require `confirm: true`; without it they refuse and never touch your server.

**Fast by default.** The SSH channel is a single kept-alive connection (lazy connect, keepalive probes, auto-reconnect, idle disconnect after `UNRAID_SSH_IDLE_SECONDS`) instead of a handshake per command. GraphQL requests reuse a keep-alive HTTP agent, carry a hard 30 s timeout, and idempotent queries get a small jittered retry on transient failures. The hottest reads (`system_metrics`, `array_status`, `docker_container_list`) are served from a 5-second snapshot cache — detailed output includes `data_age_ms` so you always know how fresh the data is. Long-running `shell_exec` and `docker_container_update` calls emit MCP progress notifications when the client requests them (stdio or session-mode HTTP).

**Cautious by default.** Set `MCP_READ_ONLY=true` and the server registers only read-only tools — state-changing tools are structurally absent from the listing, not merely rejected. All tool output passes through secret redaction (your configured API key, SSH password, bearer token, credential-shaped key/values, and JWTs are replaced with `[redacted]`), a client-side rate limiter keeps request bursts inside the Unraid API's configured throttle, and oversized JSON results are truncated into an envelope that always survives `JSON.parse`.

### System and storage

| Tool | Type | Description |
| --- | --- | --- |
| `system_info` | read-only | OS, kernel, uptime, hostname, and CPU summary. |
| `array_status` | read-only | Array state, capacity, current parity-check status, and per-disk health. |
| `parity_history` | read-only | Recent parity checks (date, status, errors, speed). |
| `disk_list` | read-only | Physical disks with model, size, SMART status, temperature, and partitions. |
| `disk_smart_report` | read-only | Full smartctl attribute report for one disk (SSH). |
| `disk_spin` | mutation | Spins a disk up or down (SSH; `confirm`): array slots via emhttpd for consistent state, unassigned `/dev/sdX` via sdspin (ATA only). |
| `share_list` | read-only | User shares with usage; filter by name. |
| `mover_status` | read-only | Whether the mover (cache-to-array migration) is running, plus its schedule. |
| `system_health` | read-only | One severity-scored health rollup (OK / WARNING / CRITICAL) across array, capacity, disks/temps, parity, notifications, UPS, and pending container updates. Start here. |
| `connection_doctor` | read-only | Self-test of this MCP server's plumbing: GraphQL reachability/latency, API key validity, versions, SSH connectivity, rate-limit config, read-only mode. Run it first when something misbehaves. |
| `gpu_metrics` | read-only | GPU utilization over SSH — full metrics via nvidia-smi, a bounded sample via intel_gpu_top, clear absence report otherwise. |
| `process_list` | read-only | The host's busiest processes by CPU or memory (SSH). |
| `mover_action` | destructive | Starts or stops the mover over SSH (requires `confirm: true`). Stopping can leave partial files on the destination. |
| `system_power` | destructive | Reboots or shuts down the whole server over SSH. Requires `confirm: true` and `acknowledge_risk: true`. |

### Array control

Both tools require an API key with the **ADMIN** role. They report that the request was issued; run `array_status` afterward to confirm the result.

| Tool | Type | Description |
| --- | --- | --- |
| `array_action` | destructive | Starts or stops the array. Stopping takes every share, container, and VM offline, so `stop` also requires `acknowledge_risk: true`. |
| `array_disk_action` | destructive | Add/remove a disk to/from the array (needs a STOPPED array — checked first), mount/unmount an array disk, or clear disk statistics. Requires `confirm` + `acknowledge_risk`. |
| `parity_check` | destructive | Starts (optionally correcting), pauses, resumes, or cancels a parity check. |

### Docker

| Tool | Type | Description |
| --- | --- | --- |
| `docker_container_list` | read-only | Containers with state, image, and update availability; filter by name. |
| `docker_container_logs` | read-only | Recent log lines for a container, with tail and time-based paging. |
| `docker_network_list` | read-only | Docker networks (driver, scope, IPv6/internal/attachable). |
| `docker_port_conflicts` | read-only | Container and LAN port conflicts. |
| `docker_stats` | read-only | Per-container CPU, memory, network, and block IO usage, hungriest first. Needs SSH configured (see Host shell). |
| `docker_container_action` | destructive | Start, stop, pause, unpause, or restart a container (restart is composed stop-then-start; the API has no restart mutation). |
| `docker_container_remove` | destructive | Permanently deletes a container (irreversible); optionally deletes its image. Needs Unraid 7.3+. |
| `docker_container_update` | destructive | Pulls the latest image and recreates containers, by id or all with updates. Needs Unraid 7.3+. |
| `docker_autostart_set` | destructive | Sets which containers auto-start on boot, merge-safely preserving boot order. Needs Unraid 7.3+. |

### Virtual machines

| Tool | Type | Description |
| --- | --- | --- |
| `vm_list` | read-only | Virtual machines with run state; filter by name. |
| `vm_action` | destructive | Start, stop, pause, resume, forceStop, reboot, or reset a VM by name or id. `forceStop` and `reset` are ungraceful and also require `acknowledge_risk: true`. |
| `vm_snapshot_list` | read-only | Lists a VM's libvirt snapshots via virsh (SSH; not exposed by the GraphQL API). |
| `vm_snapshot_create` | destructive | Creates an EXTERNAL disk snapshot via virsh (the flow Unraid 7 itself uses). Requires `confirm` + `acknowledge_risk`. Revert/delete deliberately stay in the Unraid UI. |

### Notifications

| Tool | Type | Description |
| --- | --- | --- |
| `notification_overview` | read-only | Unread and archived counts broken down by importance. |
| `notification_list` | read-only | Notifications by type (`unread` or `archive`) with paging; the source of truth for ids. |
| `notification_alerts` | read-only | Deduplicated unread warnings and alerts: the "needs attention now" view. |
| `notification_archive` | mutation | Archives or unarchives notifications (reversible, ungated). |
| `notification_unread` | mutation | Marks one notification as unread again (reversible, ungated). |
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
| `plugin_install_plg` | destructive | Installs a native Unraid OS plugin from a `.plg` URL. A `.plg` runs arbitrary code as root, so this requires `confirm` + `acknowledge_risk` — only install from trusted sources. |

### ZFS (SSH)

ZFS ships with Unraid 6.12+; these tools report clearly when no pools exist.

| Tool | Type | Description |
| --- | --- | --- |
| `zfs_status` | read-only | Pool health/capacity plus ARC memory usage. |
| `zfs_dataset_list` | read-only | Datasets with used/available space and mountpoints; optional pool filter. |
| `zfs_snapshot_list` | read-only | Snapshots with size and creation time; optional dataset filter. |
| `zfs_snapshot_action` | destructive | Create, destroy, or roll back a snapshot. Rollback discards everything after the snapshot, so this requires `confirm` + `acknowledge_risk`. |

### User Scripts (SSH)

| Tool | Type | Description |
| --- | --- | --- |
| `user_script_list` | read-only | Lists scripts managed by the User Scripts plugin. |
| `user_script_run` | destructive | Runs one user script (arbitrary root code by design — `confirm` + `acknowledge_risk`), replicating the plugin's noexec-safe runner. |

### API keys

Managing API keys means the model is handling the credentials that control access to your server — treat these tools with the same care as the keys themselves.

| Tool | Type | Description |
| --- | --- | --- |
| `apikey_list` | read-only | Lists configured API keys (name, roles, permissions, created). Key values are never selected or returned. |
| `apikey_manage` | destructive | Create, update, add/remove roles, or delete API keys. Requires `confirm` + `acknowledge_risk`. The key value is disclosed exactly once, at creation. Deleting the key this MCP server uses locks it out. |

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

### Raw GraphQL (advanced)

Escape hatches for the parts of the Unraid API no dedicated tool wraps yet (users, API keys, registration, share edits, disk operations). Prefer the dedicated tools when one exists: they encode server quirks these passthroughs do not. The full schema ships with the package at `schema/unraid.graphql`.

| Tool | Type | Description |
| --- | --- | --- |
| `graphql_query` | read-only | Runs an arbitrary GraphQL query and returns the raw JSON. Query operations only; output is capped. |
| `graphql_mutation` | destructive | Runs an arbitrary GraphQL mutation. Requires `confirm: true` on every call, plus `acknowledge_risk: true` when it selects a known-dangerous field (`setState`, `forceStop`, `reset`, `configureUps`). Verify results with a follow-up read. |

> **Note:** tool behavior is validated against the Unraid API v4.35.0 source and covered by 370+ unit tests, but has not yet been broadly exercised against live servers. Treat destructive tools with care and please [open an issue](https://github.com/mswdev/better-unraid-mcp/issues) if anything misbehaves.

## Modern MCP surface

Beyond tools, the server speaks the wider MCP protocol:

- **Interactive confirmation (elicitation).** When your client supports MCP elicitation (over stdio or session-mode HTTP), gated tools present a real confirmation prompt — tier-2 actions show the blast-radius warning with two checkboxes — instead of refusing. The `confirm` / `acknowledge_risk` arguments still work everywhere and remain the only path on stateless HTTP. Declining the prompt changes nothing on the server.
- **Resources.** `unraid://schema` (the vendored GraphQL SDL this package was built against), `unraid://health` (the system-health rollup as JSON), and `unraid://doctor` (the connection self-test as JSON).
- **Prompts.** Four guided workflows: `triage-array-problem`, `find-resource-hog`, `safe-container-update` (takes an optional `container` argument), and `health-report`.
- **Structured output.** `system_health`, `system_metrics`, `array_status`, and `docker_container_list` declare an `outputSchema` and return `structuredContent` alongside the human text in both response formats.
- **Complete annotations.** Every tool declares `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`, enforced by a registry test.

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
| `MCP_READ_ONLY` | no | `false` | Set `true` to hide every state-changing tool — the server registers read-only tools only. |
| `MCP_HTTP_BEARER_TOKEN` | http | | Required for the `http` transport: clients must send `Authorization: Bearer <token>`. |
| `MCP_HTTP_ALLOW_UNAUTHENTICATED` | no | `false` | Explicit opt-in to run the `http` transport with no auth (trusted networks only). |
| `LOG_LEVEL` | no | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |
| `UNRAID_SSH_HOST` | no | | Enables the host-shell tools (`file_read`, `shell_exec`, `docker_stats`). Requires a password or key path. |
| `UNRAID_SSH_PORT` | no | `22` | SSH port. |
| `UNRAID_SSH_USER` | no | `root` | SSH user. Unraid administration is normally `root`. |
| `UNRAID_SSH_PASSWORD` | no | | SSH password. Prefer `UNRAID_SSH_KEY_PATH` where possible. |
| `UNRAID_SSH_KEY_PATH` | no | | Path to an SSH private key file (readable by the MCP server process). |
| `UNRAID_SSH_IDLE_SECONDS` | no | `90` | Idle seconds before the persistent SSH connection is closed (it reconnects lazily). |
| `MCP_HTTP_SESSIONS` | no | `false` | Set `true` for stateful HTTP sessions (SSE responses). Enables server-initiated messages — progress notifications now, elicitation and subscriptions in later releases. |

See [`.env.example`](.env.example) for a copy-paste template.

## Remote / HTTP transport

For remote or hosted clients, run over Streamable HTTP instead of stdio:

```bash
MCP_TRANSPORT=http \
MCP_HTTP_BEARER_TOKEN=some-long-random-token \
UNRAID_API_URL=https://tower.local/graphql \
UNRAID_API_KEY=your-api-key \
npx -y better-unraid-mcp@latest
```

The MCP endpoint is then `POST http://host:3000/mcp`, and every request must carry the token:

```bash
curl -X POST http://host:3000/mcp \
  -H "Authorization: Bearer some-long-random-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

By default the endpoint is stateless: each POST gets a complete JSON response, and server-initiated messages (progress notifications, and in later releases elicitation prompts and subscription updates) are silently unavailable. Set `MCP_HTTP_SESSIONS=true` to switch to stateful streamable-HTTP sessions: the client initializes once, carries the returned `mcp-session-id` header, receives SSE responses that can carry server-initiated messages, and may end the session with a DELETE. Idle sessions expire after 5 minutes.

The server **refuses to start** in HTTP mode without `MCP_HTTP_BEARER_TOKEN`. To deliberately run an open endpoint on a trusted network, set `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` (a warning is logged at startup). Requests without a matching token get a 401; token comparison is constant-time.

> **Warning:** every request uses your privileged Unraid API key upstream. The server binds to localhost by default. To expose it further (including to cloud clients such as ChatGPT connectors), add TLS via a reverse proxy and set `MCP_HTTP_ALLOWED_HOSTS` for DNS-rebinding protection. Never expose the endpoint unauthenticated to an untrusted network.

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
