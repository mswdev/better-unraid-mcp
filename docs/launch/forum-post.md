# Unraid forum post

Draft for a support thread in the Unraid forums' **Docker Containers** board (forums.unraid.net/forum/47), which is where other MCP containers keep their `[Support]` threads and where Community Applications expects one. The forum editor does not render Markdown, so paste it section by section or convert it to rich text first.

Before posting:
- **Rewrite it in your own words.** This draft is AI-assisted, and forum regulars push back on AI-written posts (see `distribution.md`).
- **Fill in the AI line** near the end.
- **Don't compare it with other Unraid MCP projects.** The author of the best-known one is now on Unraid staff.

**Title:** [Support] better-unraid-mcp: manage your Unraid server from Claude, Codex, or any MCP client

---

**TL;DR:** better-unraid-mcp is an open-source [MCP](https://modelcontextprotocol.io) server for Unraid's built-in GraphQL API. You don't install anything on your server. It runs on your desktop or laptop next to your AI client, talks to `https://your-server/graphql` with an API key, and gives the model 67 tools: health rollups, logs, Docker, VMs, array and parity control, ZFS, SMART, UPS, notifications, live WebSocket telemetry, and metric history. With optional SSH it can also manage services, shares, unassigned devices, and flash backups.

**GitHub:** https://github.com/mswdev/better-unraid-mcp
**Run it:** `npx -y better-unraid-mcp@latest`
**Also available as:** a one-click `.mcpb` bundle for Claude Desktop on the releases page, a Claude Code plugin marketplace, the `ghcr.io/mswdev/better-unraid-mcp` Docker image for the HTTP transport, and the official MCP Registry entry `io.github.mswdev/better-unraid-mcp`.

## Why I built it

I wanted to ask "why is my array degraded?" and get a real answer put together from `array_status`, `disk_list`, and SMART, without SSHing in or opening five WebGUI tabs. I built it around two ideas.

1. Nothing to install on the NAS. You need one API key (Settings > Management Access > API Keys, Unraid 7.2+), plus SSH credentials if you want the host-level tools. Nothing runs on the array.
2. Safe by default. Every destructive tool refuses to run without `confirm: true`, and the dangerous ones (array stop, host reboot, VM hard-kill, ZFS rollback) also need `acknowledge_risk: true`. If your client supports MCP elicitation, you get a real confirmation prompt instead. `MCP_READ_ONLY=true` removes every state-changing tool from the listing, and with a VIEWER key on top, nothing in this server can change your machine.

## What it can do

- Health rollup in one call (`system_health`): array, capacity, disk temperatures and SMART, parity, unread alerts, UPS, and pending container updates, scored OK, WARNING, or CRITICAL.
- Logs: list, tail, and page through any server log, or follow one live over WebSocket.
- Docker: list, logs, and stats (from the live subscription, with an SSH fallback), start, stop, restart, image updates, autostart order, and port-conflict detection.
- VMs: lifecycle control through the API, and external snapshots through virsh, the same way Unraid 7 takes them.
- Array and parity: status, start and stop, parity checks and history, adding and mounting disks (with array-state checks first), mover control, and disk spin.
- ZFS: pool status and ARC, datasets, and snapshot list, create, destroy, and rollback.
- Host configuration over SSH: service status and restart (samba, nfs, sshd, docker, libvirt), user share create, edit, and delete through emhttpd exactly as the web UI does it, Unassigned Devices mount and unmount, and a verified flash backup into a share.
- History: an opt-in in-memory recorder keeps 24 hours of CPU, memory, and network data at 30-second resolution (`metrics_history`).
- Everything else: SMART deep reports, GPU metrics (NVIDIA and Intel), the process list, User Scripts, notifications, UPS, API-key management, native `.plg` installs, raw GraphQL with local schema validation and a dry-run mode, and a `doctor` command that checks your setup, including schema skew against your server's API version.

## Caveats

- Your API key can control the server. Scope it (VIEWER is enough for read-only use) and treat it like a password.
- The optional HTTP transport refuses to start without a bearer token. Even so, don't expose it straight to the internet; put TLS in front.
- Mutations report that the change was requested and point you at a read to verify it, because Unraid's API returns the state from before the mutation.
- I've run the read-only tools against my own Unraid 7.3.2 server. The write tools are covered by the unit tests (100% coverage) but haven't had much live use yet, so reports from real servers are very welcome.
- Where the API is a stub (its flash-backup mutation), the tool goes over SSH instead. Where the API reports the wrong thing (UPS data on a NUT-managed server, partition lists on servers with more than 26 disks), the tool says so instead of passing it along.
- It's built on the MCP TypeScript SDK v2 (protocol 2026-07-28), and older clients negotiate down automatically.

## Quickstart (Claude Code)

```bash
claude mcp add better-unraid \
  -e UNRAID_API_URL=https://tower.local/graphql \
  -e UNRAID_API_KEY=your-api-key \
  -- npx -y better-unraid-mcp@latest
```

On Claude Desktop, download the `.mcpb` from the latest GitHub release and open it. The README has the Codex, Gemini CLI, and Docker setups and documents every tool and configuration option.

How I built it: [OWNER: one or two honest sentences on how you used AI tools while building this.]

Feedback, bug reports, and "it broke on my server" reports are all welcome, here or as a [GitHub issue](https://github.com/mswdev/better-unraid-mcp/issues).
