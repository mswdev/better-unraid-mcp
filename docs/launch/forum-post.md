# [Forum draft] better-unraid-mcp — talk to your Unraid server from Claude, Codex, or any MCP client

> Draft announcement for the Unraid forums (General Support / Plugin Support section TBD by owner). Tone: honest, no hype, lead with safety.

---

**TL;DR:** `better-unraid-mcp` is an open-source [MCP](https://modelcontextprotocol.io) server for Unraid's built-in GraphQL API. Nothing gets installed on your server — it runs on your desktop/laptop next to your AI client, talks to `https://your-server/graphql` with an API key, and gives the model 67 carefully-gated tools: health rollups, logs, Docker, VMs, array and parity control, ZFS, SMART, UPS, notifications, and live WebSocket telemetry.

**GitHub:** https://github.com/mswdev/better-unraid-mcp · **npm:** `npx -y better-unraid-mcp@latest`

## Why another one?

I wanted to ask "why is my array degraded?" and get a real answer assembled from `array_status`, `disk_list`, and SMART — without SSHing in or opening five WebGUI tabs. Existing Unraid MCP/agent projects either install a daemon on the server or expose flat, ungated API wrappers. This one is built around two ideas:

1. **Zero install on the NAS.** One API key (Settings → Management Access → API Keys, Unraid 7.2+). Optional SSH creds if you want host-level tools. Nothing running on the array.
2. **Safe by default.** Every destructive tool refuses without `confirm: true`; the truly dangerous ones (array stop, host reboot, VM hard-kill, ZFS rollback) also demand `acknowledge_risk: true`. If your client supports MCP elicitation you get a real confirmation prompt instead. And `MCP_READ_ONLY=true` removes every mutating tool from the listing entirely — combined with a VIEWER key, the model physically cannot change anything.

## What it can do

- **One-call health rollup** (`system_health`): array, capacity, disk temps/SMART, parity, unread alerts, UPS, pending container updates, scored OK/WARNING/CRITICAL.
- **Logs**: list and tail/page any server log; follow logs live over WebSocket.
- **Docker**: list/logs/stats (live subscription-fed with SSH fallback), start/stop/restart, updates, autostart order, port-conflict detection.
- **VMs**: lifecycle control via the API, external snapshots via virsh (the same flow Unraid 7 uses).
- **Array & parity**: status, start/stop, parity checks + history, disk add/remove/mount with array-state preconditions, mover control, disk spin.
- **ZFS**: pool status + ARC, datasets, snapshot list/create/destroy/rollback.
- **Plus**: SMART deep reports, GPU metrics (NVIDIA/Intel), process list, User Scripts, notifications, UPS, API-key management, native `.plg` installs, and raw GraphQL escape hatches.

## Honest caveats

- Your API key can control the server; scope it (VIEWER for read-only use) and treat it like a password.
- The optional HTTP transport **refuses to start without a bearer token** — don't expose it raw to the internet regardless; put TLS in front.
- Mutations report "requested" and point you at the verification read, because Unraid's API returns pre-mutation state (we don't pretend otherwise).
- Some upstream API areas are stubs (e.g. flash backup) — we deliberately ship nothing against them rather than tools that can't work.

## Quickstart (Claude Code)

```bash
claude mcp add better-unraid \
  -e UNRAID_API_URL=https://tower.local/graphql \
  -e UNRAID_API_KEY=your-api-key \
  -- npx -y better-unraid-mcp@latest
```

Claude Desktop / Codex / Gemini CLI snippets are in the README. Feedback, bug reports, and "it broke on my server" reports are very welcome — the README documents every tool and configuration flag.
