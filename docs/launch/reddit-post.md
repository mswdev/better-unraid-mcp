# Reddit post (r/unRAID)

Reddit renders this Markdown in the Markdown editor. Post it as a text post, not a bare link, and link the forum support thread once it exists.

This draft is AI-assisted. Rewrite it in your own words, and fill in the AI line, before posting anywhere. r/mcp bans AI-written posts; r/ClaudeAI, r/selfhosted and r/homelab require you to disclose AI use, each with its own flair. The per-subreddit rules and angles are in `distribution.md`.

**Title:** I built an open-source MCP server so Claude (or any AI client) can check on and manage my Unraid server

---

I got tired of opening five WebGUI tabs to work out why something on my server was unhappy, so I built **better-unraid-mcp**. It's an MCP server for Unraid's built-in GraphQL API. You connect it to Claude Desktop, Claude Code, Codex, Gemini CLI, or any other MCP client and ask things like:

- "Why is my array degraded?"
- "Which container is eating all my RAM?"
- "Tail the syslog."
- "Restart Plex."

Nothing gets installed on the server. It runs on your desktop or laptop with `npx`, talks to `https://your-server/graphql` with an API key (Unraid 7.2+), and gives the model 67 tools: a health rollup, logs, Docker, VMs, array and parity, ZFS, SMART, UPS, notifications, and live WebSocket telemetry. With optional SSH it can also handle services, shares, Unassigned Devices, and flash backups.

**On safety**, since that's the first question anyone should ask about letting an AI near their NAS:

- Every destructive tool refuses to run without `confirm: true`. Stopping the array, rebooting, hard-killing a VM, or rolling back a ZFS snapshot also needs `acknowledge_risk: true`. Clients that support MCP elicitation show a real confirmation prompt instead.
- `MCP_READ_ONLY=true` removes every state-changing tool. Use it with a VIEWER-role key and nothing in this server can change your machine.
- API keys, SSH passwords, and tokens are redacted from all tool output.

**Try it (Claude Code):**

```
claude mcp add better-unraid \
  -e UNRAID_API_URL=https://tower.local/graphql \
  -e UNRAID_API_KEY=your-api-key \
  -- npx -y better-unraid-mcp@latest
```

Claude Desktop users can grab the one-click `.mcpb` from the releases page. There's also a Docker image for the HTTP transport, and setups for the other clients are in the README.

**Caveats:** I've run the read-only tools against my own 7.3.2 server, and the whole thing has 100% unit-test coverage, but the write tools haven't had much live use yet. Bug reports from real servers would help a lot.

How I built it: [OWNER: one or two honest sentences on how you used AI tools while building this.]

GitHub (MIT): https://github.com/mswdev/better-unraid-mcp
