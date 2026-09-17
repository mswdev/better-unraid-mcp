# better-unraid (Claude Code plugin)

Installs the `better-unraid-mcp` MCP server into Claude Code.

```bash
claude plugin marketplace add mswdev/better-unraid-mcp
claude plugin install better-unraid@better-unraid-mcp
```

Set these in the environment Claude Code runs in (a `.env` is not read by plugins):

| Variable | Required | Purpose |
| --- | --- | --- |
| `UNRAID_API_URL` | yes | e.g. `https://tower.local/graphql` |
| `UNRAID_API_KEY` | yes | Settings → Management Access → API Keys |
| `UNRAID_SSH_HOST` / `UNRAID_SSH_PASSWORD` | no | host-level tools (services, shares, flash backup, shell) |
| `MCP_READ_ONLY` | no | `true` hides every state-changing tool |

The server itself runs with `npx -y better-unraid-mcp@latest`; nothing is installed on the Unraid box. Full tool reference: https://github.com/mswdev/better-unraid-mcp#tools
