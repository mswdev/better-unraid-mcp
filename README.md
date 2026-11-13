<div align="center">

# Better Unraid MCP

**Monitor and manage your Unraid server in plain English, from any MCP client.**

[![npm version](https://img.shields.io/npm/v/better-unraid-mcp)](https://www.npmjs.com/package/better-unraid-mcp)
[![CI](https://github.com/mswdev/better-unraid-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mswdev/better-unraid-mcp/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmswdev%2Fbetter-unraid-mcp%2Fbadges%2Fcoverage-summary.json&query=%24.total.lines.pct&suffix=%25&label=coverage&color=brightgreen)](https://github.com/mswdev/better-unraid-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

[![MCP protocol 2026-07-28](https://img.shields.io/badge/MCP-2026--07--28-8b5cf6)](https://modelcontextprotocol.io)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.mswdev%2Fbetter--unraid--mcp-0ea5e9)](https://registry.modelcontextprotocol.io/v0.1/servers?search=better-unraid-mcp)
[![Docker](https://img.shields.io/badge/ghcr.io-better--unraid--mcp-2496ed?logo=docker&logoColor=white)](https://github.com/mswdev/better-unraid-mcp/pkgs/container/better-unraid-mcp)
[![Claude Desktop bundle](https://img.shields.io/badge/.mcpb-one--click%20install-d97706)](https://github.com/mswdev/better-unraid-mcp/releases/latest)

[Features](#features) · [Quick start](#quick-start) · [Tools](#tools) · [MCP features](#mcp-features-beyond-tools) · [Configuration](#configuration) · [HTTP transport](#remote-http-transport) · [Security](#security) · [FAQ](#faq) · [Development](#development)

<img src="assets/demo.svg" alt="Better Unraid MCP in a Claude Code session: asking why the array is degraded, getting a health rollup, and a gated container restart" width="760">

</div>

Better Unraid MCP is an open-source Unraid MCP server. It connects Claude Desktop, Claude Code, Codex, Gemini CLI, or any other [Model Context Protocol](https://modelcontextprotocol.io) client to the [Unraid](https://unraid.net) GraphQL API, so you can ask things like *"why is my array degraded?"*, *"tail the syslog"*, or *"restart the Plex container"*.

## Features

Ask a plain question and get a real answer from your server. "Why is my array degraded?" turns into calls to `array_status` and `disk_list`, and you find out which disk is unhappy and what SMART thinks of it without opening an SSH session or clicking through WebGUI tabs.

The 67 tools cover most of what you would normally do over SSH or in the WebGUI:

- Diagnose problems in one conversation: unread alerts, CPU and memory pressure, network errors, disk temperatures, SMART health
- Read any log on the server: list them all, tail the syslog, or page through the middle of a huge file
- Manage Docker: container status and logs, per-container resource usage, start and stop, image updates, port conflict detection, boot autostart order
- Control VMs through libvirt, from a graceful shutdown to a hard reset
- Run the array: start or stop it, manage parity checks, review parity history, check the mover
- Triage notifications: read, archive, and clear the alerts you have been putting off
- Watch the UPS during an outage: battery charge, runtime estimate, load
- Go past the API when you need to (optional, via SSH): read any file on the host, such as `/boot/logs/syslog-previous`, or run a confirmed one-off command
- Work with ZFS: pool health, datasets, snapshots (create, destroy, rollback), and ARC usage
- Reach the host when the API can't: processes, GPU metrics, disk spin, SMART deep reports, User Scripts, VM snapshots
- Manage the platform itself: API keys, native `.plg` plugin installs, mover control, reboot and shutdown
- Watch things live: WebSocket-fed resources for parity progress, Docker stats, system metrics (CPU, memory, network, temperature), UPS, array state, notifications, and log following (`unraid://live/*`, `unraid://logs/{path}`)
- Reach the rest of the API with raw `graphql_query` and a confirm-gated `graphql_mutation` while dedicated tools catch up

The tools are deliberately paranoid. A destructive tool refuses to run unless the request includes `confirm: true`, so a stray sentence in a chat can't stop your array. The operations that can really hurt (stopping the array, hard-killing a VM, rebooting the host) also need `acknowledge_risk: true`. If your client supports MCP elicitation, you get an interactive confirmation prompt instead. Every read works with a viewer-level API key, and `MCP_READ_ONLY=true` takes every state-changing tool out of the listing.

You don't install anything on the Unraid server. The MCP server runs on your machine, talks to Unraid's built-in GraphQL API with one API key, and starts with a single `npx` command.

## Quick start

### 1. Create an Unraid API key

On your Unraid server (7.2 or newer), go to **Settings > Management Access > API Keys** and create a key. Or from the Unraid terminal:

```bash
unraid-api apikey --create
```

> [!IMPORTANT]
> The key controls your server, so treat it like a password and give it the least privilege you need. A viewer-level key is enough for every read-only tool.

### 2. Add the server to your MCP client

<details open>
<summary><strong>Claude Code</strong></summary>

```bash
claude mcp add better-unraid \
  -e UNRAID_API_URL=https://tower.local/graphql \
  -e UNRAID_API_KEY=your-api-key \
  -- npx -y better-unraid-mcp@latest
```

</details>

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

If your server uses a self-signed TLS certificate on the LAN, also set `UNRAID_ALLOW_SELF_SIGNED=true`. To turn on the SSH-backed tools (reading files like `/boot/logs/syslog-previous`, ZFS, running one-off commands, and the rest of the tools marked SSH below), also pass the `UNRAID_SSH_*` variables described under [Configuration](#configuration). `@latest` keeps you on the newest release; pin a version (for example `better-unraid-mcp@0.1.1`) if you want fully predictable behavior.

#### Other ways to install

All of them run the same server, and none of them install anything on the Unraid box.

| Option | Details |
| --- | --- |
| Claude Desktop, one click | Download `better-unraid-mcp-<version>.mcpb` from the [latest release](https://github.com/mswdev/better-unraid-mcp/releases/latest) and open it. Claude Desktop asks for the URL and API key. |
| Claude Code plugin marketplace | `claude plugin marketplace add mswdev/better-unraid-mcp`, then `claude plugin install better-unraid@better-unraid-mcp`. The plugin reads `UNRAID_API_URL` and `UNRAID_API_KEY` from your environment. |
| Docker (remote HTTP transport) | `ghcr.io/mswdev/better-unraid-mcp`. See [Docker](#docker-http-transport). |
| MCP Registry | Listed as `io.github.mswdev/better-unraid-mcp` for clients that browse the registry. |

#### Cautious quickstart (read-only)

Not ready to let a model touch anything? Add `MCP_READ_ONLY=true` to the environment above and the server registers only the read-only tools. The state-changing tools aren't refused at call time; they never appear at all. Pair that with a VIEWER-role API key and nothing in this server can change your machine.

### 3. Verify your setup

Before wiring up a client, run the built-in doctor with the same environment:

```bash
UNRAID_API_URL=https://tower.local/graphql UNRAID_API_KEY=... npx better-unraid-mcp doctor
```

It prints one line per check (GraphQL reachability and versions, schema skew against the server's API version, SSH when configured, rate limiting, and read-only mode) and exits non-zero when something is broken:

```text
✓ Reachable in 12 ms — Unraid 7.3.2, API 4.37.4+ad268301, online=true.
✓ Vendored schema matches the server API (4.37.4 vs 4.37.4+ad268301).
⚠ SSH: not configured (optional). Host tools (...) are unavailable; set UNRAID_SSH_* to enable them.
✓ Client-side rate limiting active: 90 request burst, 9/s refill.
✓ read-only mode: disabled — mutating tools are registered (each behind its confirm gate).
doctor: OK
```

### 4. Try it

Ask your client:

> "What's the status of my Unraid array?"

## Tools

Read-only tools never change anything. Destructive tools always require `confirm: true`; without it they refuse and leave your server alone.

| Category | Tools |
| --- | --- |
| [System and storage](#system-and-storage) | 14 |
| [Array control](#array-control) | 3 |
| [Docker](#docker) | 9 |
| [Virtual machines](#virtual-machines) | 4 |
| [Notifications](#notifications) | 8 |
| [Observability](#observability) | 4 |
| [Plugins](#plugins) | 4 |
| [ZFS (SSH)](#zfs-ssh) | 4 |
| [Host configuration (SSH)](#host-configuration-ssh) | 7 |
| [Backup (SSH)](#backup-ssh) | 1 |
| [User Scripts (SSH)](#user-scripts-ssh) | 2 |
| [API keys](#api-keys) | 2 |
| [UPS](#ups) | 1 |
| [Host shell (optional, needs SSH)](#host-shell-optional-needs-ssh) | 2 |
| [Raw GraphQL (advanced)](#raw-graphql-advanced) | 2 |

### Speed and safety

The SSH channel is one kept-alive connection: it connects lazily, sends keepalive probes, reconnects on its own, and closes after `UNRAID_SSH_IDLE_SECONDS` of idle time, so commands don't pay for a new handshake each time. GraphQL requests reuse a keep-alive HTTP agent and have a hard 30-second timeout, and idempotent queries get a small jittered retry on transient failures. The busiest reads (`system_metrics`, `array_status`, `docker_container_list`) come from a 5-second snapshot cache, and detailed output includes `data_age_ms` so you can see how fresh the data is. Long-running `shell_exec` and `docker_container_update` calls send MCP progress notifications when the client asks for them (stdio or session-mode HTTP).

All tool output goes through secret redaction: your configured API key, SSH password, and bearer token, plus credential-shaped key/value pairs and JWTs, come back as `[redacted]`. A client-side rate limiter keeps request bursts inside the Unraid API's throttle, and oversized JSON results are truncated into an envelope that still parses with `JSON.parse`.

### System and storage

<details>
<summary>14 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `system_info` | read-only | OS, kernel, uptime, hostname, and CPU summary. |
| `array_status` | read-only | Array state, capacity, current parity-check status, and per-disk health. |
| `parity_history` | read-only | Recent parity checks (date, status, errors, speed). |
| `disk_list` | read-only | Physical disks with model, size, SMART status, temperature, and partitions. |
| `disk_smart_report` | read-only | Full smartctl attribute report for one disk (SSH). |
| `disk_spin` | mutation | Spins a disk up or down (SSH; `confirm`): array slots through emhttpd so the state stays consistent, unassigned `/dev/sdX` through sdspin (ATA only). |
| `share_list` | read-only | User shares with usage; filter by name. |
| `mover_status` | read-only | Whether the mover (cache-to-array migration) is running, plus its schedule. |
| `system_health` | read-only | One severity-scored health rollup (OK / WARNING / CRITICAL) across array, capacity, disks and temperatures, parity, notifications, UPS, and pending container updates. Start here. |
| `connection_doctor` | read-only | Self-test of this MCP server's plumbing: GraphQL reachability and latency, API key validity, versions, schema skew (vendored schema vs the server's API version), SSH connectivity, rate-limit config, and read-only mode. Run it first when something misbehaves; it is also available as `npx better-unraid-mcp doctor`. |
| `gpu_metrics` | read-only | GPU utilization over SSH: full metrics from nvidia-smi, a one-line summary (frequency, idle share, engine load, GPU clients) parsed from intel_gpu_top, or a clear report when neither is present. |
| `process_list` | read-only | The host's busiest processes by CPU or memory (SSH). |
| `mover_action` | destructive | Starts or stops the mover over SSH (requires `confirm: true`). Stopping can leave partial files on the destination. |
| `system_power` | destructive | Reboots or shuts down the whole server over SSH. Requires `confirm: true` and `acknowledge_risk: true`. |

</details>

### Array control

Both tools require an API key with the **ADMIN** role. They report that the request was issued; run `array_status` afterward to confirm the result.

<details>
<summary>3 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `array_action` | destructive | Starts or stops the array. Stopping takes every share, container, and VM offline, so `stop` also requires `acknowledge_risk: true`. |
| `array_disk_action` | destructive | Adds a disk to the array (checks first that the array is STOPPED), mounts or unmounts an array disk, or clears disk statistics. The Unraid API (4.37+) no longer supports removing a disk, so use the web UI for that. Requires `confirm` + `acknowledge_risk`. |
| `parity_check` | destructive | Starts (optionally correcting), pauses, resumes, or cancels a parity check. |

</details>

### Docker

<details>
<summary>9 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `docker_container_list` | read-only | Containers with state, image, and update availability; filter by name. |
| `docker_container_logs` | read-only | Recent log lines for a container, with tail and time-based paging. |
| `docker_network_list` | read-only | Docker networks (driver, scope, IPv6/internal/attachable). |
| `docker_port_conflicts` | read-only | Container and LAN port conflicts. |
| `docker_stats` | read-only | Per-container CPU, memory, network, and block IO usage, hungriest first. Uses a fresh sample from the live WebSocket subscription when one exists and otherwise falls back to `docker stats` over SSH (see Host shell); the response says which source it used. |
| `docker_container_action` | destructive | Start, stop, pause, unpause, or restart a container (restart uses the API's native restart mutation, API 4.37+). |
| `docker_container_remove` | destructive | Permanently deletes a container (irreversible) and optionally its image. Needs Unraid 7.3+. |
| `docker_container_update` | destructive | Pulls the latest image and recreates containers, by id or all with updates. Needs Unraid 7.3+. |
| `docker_autostart_set` | destructive | Sets which containers start on boot without losing the existing boot order. Needs Unraid 7.3+. |

</details>

### Virtual machines

<details>
<summary>4 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `vm_list` | read-only | Virtual machines with run state; filter by name. |
| `vm_action` | destructive | Start, stop, pause, resume, forceStop, reboot, or reset a VM by name or id. `forceStop` and `reset` are ungraceful and also require `acknowledge_risk: true`. |
| `vm_snapshot_list` | read-only | Lists a VM's libvirt snapshots through virsh (SSH; the GraphQL API doesn't expose them). |
| `vm_snapshot_create` | destructive | Creates an EXTERNAL disk snapshot through virsh, the same way Unraid 7 does. Requires `confirm` + `acknowledge_risk`. Revert and delete stay in the Unraid UI on purpose. |

</details>

### Notifications

<details>
<summary>8 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `notification_overview` | read-only | Unread and archived counts broken down by importance. |
| `notification_list` | read-only | Notifications by type (`unread` or `archive`) with paging; the source of truth for ids. |
| `notification_alerts` | read-only | Deduplicated unread warnings and alerts: the "needs attention now" view. |
| `notification_archive` | mutation | Archives or unarchives notifications (reversible, no confirmation needed). The API swallows per-id failures, so verify with `notification_list`. |
| `notification_unread` | mutation | Marks one notification as unread again (reversible, no confirmation needed). |
| `notification_create` | mutation | Creates a notification (no confirmation needed). |
| `notification_recalculate` | mutation | Re-syncs cached overview counts from disk (no confirmation needed). |
| `notification_delete` | destructive | Permanently deletes notifications (irreversible). |

</details>

### Observability

<details>
<summary>4 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `log_list` | read-only | The server's log files with size and last-modified time. |
| `log_read` | read-only | Tails or windows a log file (default 100 lines, max 2000), with paging hints. |
| `system_metrics` | read-only | Point-in-time CPU load, memory pressure, per-interface network rates, and server time. Temperature data is opt-in. |
| `metrics_history` | read-only | Recent CPU, memory, and network history from the opt-in in-memory recorder (`MCP_METRICS_HISTORY=true`): 30-second min/avg/max buckets for up to 24 hours, with gaps reported as gaps. When recording is off, it says how to turn it on. |

</details>

### Plugins

<details>
<summary>4 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `plugin_list` | read-only | Installed API plugins and OS `.plg` plugins. |
| `plugin_add` | destructive | Installs API plugins by npm package name, then restarts the Unraid API. `npm install` on your server runs package lifecycle scripts, so only install packages you trust. |
| `plugin_remove` | destructive | Uninstalls API plugins by npm package name, then restarts the Unraid API. |
| `plugin_install_plg` | destructive | Installs a native Unraid OS plugin from a `.plg` URL. A `.plg` runs arbitrary code as root, so this requires `confirm` + `acknowledge_risk`. Only install from sources you trust. |

</details>

### ZFS (SSH)

ZFS ships with Unraid 6.12+. These tools say so plainly when no pools exist.

<details>
<summary>4 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `zfs_status` | read-only | Pool health and capacity, plus ARC memory usage. |
| `zfs_dataset_list` | read-only | Datasets with used and available space and mountpoints; optional pool filter. |
| `zfs_snapshot_list` | read-only | Snapshots with size and creation time; optional dataset filter. |
| `zfs_snapshot_action` | destructive | Create, destroy, or roll back a snapshot. Rollback discards everything after the snapshot, so this requires `confirm` + `acknowledge_risk`. |

</details>

### Host configuration (SSH)

The GraphQL API has nothing for services, share changes, or unassigned devices, so these tools use the same mechanisms as the web UI: the `/etc/rc.d/rc.*` scripts, emhttpd's form handler through `emcmd`, and the Unassigned Devices plugin. Every write is checked by reading the result back.

<details>
<summary>7 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `service_list` | read-only | Running, stopped, or not-installed state of samba, nfs, sshd, docker, libvirt, and tailscale. |
| `service_action` | destructive | `restart`, `start`, or `stop` one of those services, then check its status. `stop` needs `allow_stop: true`, and stopping docker or libvirt is refused (use `array_action`). Requires `confirm` + `acknowledge_risk`. |
| `unassigned_list` | read-only | Disks outside the array, pools, and flash, with partitions, filesystems, and mount points. |
| `unassigned_action` | destructive | Mounts or unmounts an unassigned partition through the Unassigned Devices plugin (`rc.unassigned`) and checks the result with lsblk. Refuses when the plugin isn't installed. Requires `confirm` + `acknowledge_risk`. |
| `share_create` | destructive | Creates a user share through emhttpd with a validated subset of settings (comment, allocator, cache mode and pool, SMB export and security), then checks the written `.cfg`. Requires `confirm` + `acknowledge_risk`. |
| `share_edit` | destructive | Changes that same subset of settings on an existing share, leaves the other settings alone, and checks the result by reading it back. Requires `confirm` + `acknowledge_risk`. |
| `share_delete` | destructive | Deletes an EMPTY share's configuration. It never deletes files and refuses while the share holds data. Requires `confirm` + `acknowledge_risk`. |

</details>

### Backup (SSH)

<details>
<summary>1 tool</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `flash_backup` | destructive | Archives the flash (USB boot) device into a user share as `/mnt/user/<share>/flash-backups/flash-backup-<scope>-<timestamp>.tar.gz`: `/boot/config` by default, or the whole flash with `full: true`. Each archive is checked with `tar -tzf`, and `keep: N` prunes older archives and lists what it removed. The archive contains your license key, API keys, and passwords, so it stays on your array. Requires `confirm` + `acknowledge_risk`. |

</details>

### User Scripts (SSH)

<details>
<summary>2 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `user_script_list` | read-only | Lists scripts managed by the User Scripts plugin. |
| `user_script_run` | destructive | Runs one user script with the plugin's noexec-safe runner. A user script is arbitrary root code, so this requires `confirm` + `acknowledge_risk`. |

</details>

### API keys

These tools hand the model the credentials that control access to your server, so use them with the same care as the keys themselves.

<details>
<summary>2 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `apikey_list` | read-only | Lists configured API keys (name, roles, permissions, created). Key values are never selected or returned. |
| `apikey_manage` | destructive | Creates, updates, adds or removes roles on, or deletes API keys. Requires `confirm` + `acknowledge_risk`. The key value is shown exactly once, at creation. Deleting the key this MCP server uses locks it out. |

</details>

### UPS

<details>
<summary>1 tool</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `ups_status` | read-only | Live UPS telemetry from apcupsd: status (`ONLINE`, `ONBATT`, `LOWBATT`, ...), battery charge and runtime, and power load. When apcaccess has nothing to report, it says "no live UPS data" instead of erroring or inventing a healthy reading. That includes NUT-managed servers, which the Unraid API can't see. |

</details>

### Host shell (optional, needs SSH)

The GraphQL API can't reach everything: old boot logs under `/boot/logs`, `/proc`, one-off commands. These tools fill that gap over SSH. They are off by default and turn on only when you set the `UNRAID_SSH_*` variables (see [Configuration](#configuration)); without them they refuse and explain how to set it up. `docker_stats` also falls back to this channel when no fresh live sample is available.

<details>
<summary>2 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `file_read` | read-only | Tails any absolute file path on the host (default 200 lines, max 2000). An optional `pattern` greps on the server first, so searching huge logs stays cheap. |
| `shell_exec` | destructive | Runs an arbitrary command as the SSH user (typically root). Every call requires `confirm: true`. Output is capped, and timeouts are enforced (default 30 s, max 120 s). |

</details>

### Raw GraphQL (advanced)

These cover the parts of the Unraid API that no dedicated tool wraps yet, such as users and registration. Use a dedicated tool when one exists, because the dedicated tools handle server quirks that these passthroughs don't. The full schema ships with the package at `schema/unraid.graphql`.

<details>
<summary>2 tools</summary>

| Tool | Type | Description |
| --- | --- | --- |
| `graphql_query` | read-only | Runs an arbitrary GraphQL query and returns the raw JSON. Query operations only; output is capped. Validated against the vendored schema before sending, with did-you-mean hints; `dry_run: true` validates without sending. |
| `graphql_mutation` | destructive | Runs an arbitrary GraphQL mutation. Requires `confirm: true` on every call, plus `acknowledge_risk: true` when it selects a known-dangerous field (`setState`, `forceStop`, `reset`, `configureUps`). Verify results with a follow-up read. Validated against the vendored schema before the confirm gate; `dry_run: true` validates without sending and needs no confirm. |

</details>

> [!NOTE]
> Tool behavior is checked against the vendored Unraid API 4.37.4 schema and covered by unit tests at 100% coverage. The read-only tools have been run against a live Unraid 7.3 server, but the write paths haven't been widely exercised on live servers yet. Treat destructive tools with care, and please [open an issue](https://github.com/mswdev/better-unraid-mcp/issues) if anything misbehaves.

## MCP features beyond tools

The server is built on the MCP TypeScript SDK v2 (protocol revision 2026-07-28). Clients on older revisions are negotiated down automatically.

| Feature | Details |
| --- | --- |
| Interactive confirmation (elicitation) | When your client supports MCP elicitation (over stdio or session-mode HTTP), gated tools show a real confirmation prompt instead of refusing; the riskiest actions show the warning with two checkboxes. The `confirm` and `acknowledge_risk` arguments still work everywhere and are the only option on stateless HTTP. Declining the prompt changes nothing on the server. |
| Resources | `unraid://schema` (the vendored GraphQL SDL this package was built against), `unraid://health` (the system-health rollup as JSON), `unraid://doctor` (the connection self-test as JSON), and `unraid://live/history` (the last hour of recorded CPU, memory, and network history when `MCP_METRICS_HISTORY=true`, or a hint on how to turn it on). |
| Live resources | Subscribe to `unraid://live/parity`, `unraid://live/docker-stats`, `unraid://live/metrics`, `unraid://live/ups`, `unraid://live/array`, and `unraid://live/notifications` for updates pushed over the Unraid API's WebSocket, or to `unraid://logs/{path}` to follow a log file. |
| Prompts | Four guided workflows: `triage-array-problem`, `find-resource-hog`, `safe-container-update` (takes an optional `container` argument), and `health-report`. |
| Structured output | `system_health`, `system_metrics`, `array_status`, and `docker_container_list` declare an `outputSchema` and return `structuredContent` alongside the human-readable text in both response formats. |
| Complete annotations | Every tool declares `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`, and a registry test enforces it. |

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `UNRAID_API_URL` | yes | | Full Unraid GraphQL endpoint, including `/graphql`. |
| `UNRAID_API_KEY` | yes | | API key from Quick start step 1. |
| `MCP_TRANSPORT` | no | `stdio` | `stdio` (local clients) or `http` (remote clients). |
| `MCP_HTTP_PORT` | no | `3000` | Port for the `http` transport. |
| `MCP_HTTP_HOST` | no | `127.0.0.1` | Bind address for the `http` transport. |
| `MCP_HTTP_ALLOWED_HOSTS` | no | | Comma-separated `Host` allow-list; turns on DNS-rebinding protection. |
| `UNRAID_ALLOW_SELF_SIGNED` | no | `false` | Set `true` only for a self-signed TLS certificate on the LAN. |
| `MCP_READ_ONLY` | no | `false` | Set `true` to register only the read-only tools. |
| `MCP_METRICS_HISTORY` | no | `false` | Set `true` to record CPU, memory, and network history in memory (30-second min/avg/max buckets, 24 hours, cleared on restart) for `metrics_history` and `unraid://live/history`. Keeps one WebSocket open to the server. |
| `MCP_HTTP_BEARER_TOKEN` | http | | Required for the `http` transport: clients must send `Authorization: Bearer <token>`. |
| `MCP_HTTP_ALLOW_UNAUTHENTICATED` | no | `false` | Explicit opt-in to run the `http` transport with no auth (trusted networks only). |
| `LOG_LEVEL` | no | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |
| `UNRAID_SSH_HOST` | no | | Turns on every tool marked SSH above, plus the SSH fallback for `docker_stats`. Requires a password or key path. |
| `UNRAID_SSH_PORT` | no | `22` | SSH port. |
| `UNRAID_SSH_USER` | no | `root` | SSH user. Unraid administration is normally done as `root`. |
| `UNRAID_SSH_PASSWORD` | no | | SSH password. Prefer `UNRAID_SSH_KEY_PATH` where you can. |
| `UNRAID_SSH_KEY_PATH` | no | | Path to an SSH private key file (readable by the MCP server process). |
| `UNRAID_SSH_IDLE_SECONDS` | no | `90` | Idle seconds before the persistent SSH connection closes (it reconnects when next needed). |
| `MCP_HTTP_SESSIONS` | no | `false` | Set `true` for stateful HTTP sessions (SSE responses), which carry server-initiated messages: progress notifications, elicitation prompts, and live-resource updates. |

See [`.env.example`](.env.example) for a copy-paste template.

## Remote HTTP transport

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

By default the endpoint is stateless: each POST gets a complete JSON response, and server-initiated messages (progress notifications, elicitation prompts, live-resource updates) are unavailable. Set `MCP_HTTP_SESSIONS=true` for stateful streamable-HTTP sessions. The client initializes once, sends the returned `mcp-session-id` header on later requests, receives SSE responses that can carry server-initiated messages, and can end the session with a DELETE. Idle sessions expire after 5 minutes.

The server **refuses to start** in HTTP mode without `MCP_HTTP_BEARER_TOKEN`. To run an open endpoint on a trusted network on purpose, set `MCP_HTTP_ALLOW_UNAUTHENTICATED=true`, and the server logs a warning at startup. Requests without a matching token get a 401, and the token comparison is constant-time.

> [!WARNING]
> Every request uses your privileged Unraid API key upstream. The server binds to localhost by default. To expose it further (including to cloud clients such as ChatGPT connectors), put TLS in front with a reverse proxy and set `MCP_HTTP_ALLOWED_HOSTS` for DNS-rebinding protection. Never expose the endpoint unauthenticated to an untrusted network.

### Docker (HTTP transport)

The image runs only the HTTP transport (`MCP_TRANSPORT=http`, bound to `0.0.0.0:3000` inside the container) and, like the CLI, refuses to start without `MCP_HTTP_BEARER_TOKEN`:

```yaml
services:
  better-unraid-mcp:
    image: ghcr.io/mswdev/better-unraid-mcp:latest
    ports: ["127.0.0.1:3000:3000"]
    environment:
      UNRAID_API_URL: https://tower.local/graphql
      UNRAID_API_KEY: ${UNRAID_API_KEY}
      MCP_HTTP_BEARER_TOKEN: ${MCP_HTTP_BEARER_TOKEN}
      MCP_HTTP_ALLOWED_HOSTS: localhost,mcp.example.com   # DNS-rebinding protection
      # UNRAID_SSH_HOST / UNRAID_SSH_PASSWORD for host tools; MCP_HTTP_SESSIONS=true for subscriptions/elicitation
    restart: unless-stopped
```

Point your client at `http://<host>:3000/mcp` with `Authorization: Bearer <token>`, and put TLS in front before it leaves the LAN. Every release publishes multi-arch (amd64/arm64) images.

## Security

The Unraid API key controls your server. Give it the least privilege you need, keep it only in environment variables or your client's secret store, and never commit it to version control.

## FAQ

### What is an Unraid MCP server?

The Model Context Protocol (MCP) is the standard AI clients use to call outside tools. An Unraid MCP server exposes your Unraid server's status and controls as MCP tools, so an assistant such as Claude, Codex, or Gemini CLI can check the array, read a log, or restart a container when you ask. Better Unraid MCP provides 67 of those tools.

### Is there an official Unraid MCP server?

Not as of November 2026. Unraid doesn't ship or recommend an MCP server of its own. Better Unraid MCP is an independent, MIT-licensed community project and isn't affiliated with Unraid or Lime Technology. It talks to the official GraphQL API that ships with Unraid.

### Which Unraid versions does it support?

Unraid 7.2 or newer, where the GraphQL API is built into the OS. Three Docker tools (`docker_container_remove`, `docker_container_update`, and `docker_autostart_set`) need Unraid 7.3 or newer.

### Do I have to install anything on my Unraid server?

No. The MCP server runs on your own computer with `npx` and reaches Unraid over the network with an API key. If you would rather host it, the Docker image serves the same tools over HTTP; see [Docker](#docker-http-transport).

### Which AI clients does it work with?

Any MCP client. The [Quick start](#quick-start) has setup steps for Claude Code, Claude Desktop, Codex, and Gemini CLI, and remote clients can connect over the [HTTP transport](#remote-http-transport).

### Can I keep it read-only?

Yes. Set `MCP_READ_ONLY=true` and use a VIEWER-role API key, and nothing in the server can change your machine; see the [cautious quickstart](#cautious-quickstart-read-only). With writes enabled, every destructive tool refuses to run without `confirm: true`, and the riskiest ones also need `acknowledge_risk: true`.

### Does the AI get SSH or root access to my server?

Not unless you turn it on. By default the server only calls the Unraid GraphQL API, with whatever permissions your API key has. SSH is optional: setting `UNRAID_SSH_HOST` turns on the tools marked SSH in the [tool list](#tools), such as ZFS, SMART reports, flash backup, User Scripts, file reads, and one-off commands.

## Development

```bash
git clone https://github.com/mswdev/better-unraid-mcp.git
cd better-unraid-mcp
npm install
npm run build      # or: npm run dev
```

Run the quality gate before every commit (`npm run test:coverage` also enforces the coverage threshold that CI checks):

```bash
npm run typecheck && npm run build && npm test && npm run lint
```

To contribute, branch off `develop`, keep one logical change per commit (conventional commits), and open a draft PR into `develop`. Never hand-edit the vendored schema (`schema/unraid.graphql`) or the generated types (`src/types/unraid/**`); refresh them with `npm run schema:update` and `npm run generate`.

## License

[MIT](LICENSE)
