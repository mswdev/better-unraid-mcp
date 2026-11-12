# Distribution and launch plan (0.1.1)

Where better-unraid-mcp is published, where to announce it, and in what order. The channel research was done on 2026-11-12. Rules change, so recheck a channel's rule page before posting there.

## Published automatically by `release.yml`

Every version bump merged to `main` publishes all of these. Before merging, bump the version in `package.json`, `package-lock.json`, `server.json` (twice), `manifest.json`, `src/version.ts`, `.claude-plugin/marketplace.json` (twice), `plugins/better-unraid/.claude-plugin/plugin.json`, and `gemini-extension.json`. Then run `npm run format`.

| Channel | What gets published |
|---|---|
| npm | `npx -y better-unraid-mcp@latest` (trusted publishing over OIDC). |
| GitHub Release | Tag `vX.Y.Z`, generated notes (rewrite them afterwards), and the `better-unraid-mcp-X.Y.Z.mcpb` Claude Desktop bundle. |
| ghcr.io | `ghcr.io/mswdev/better-unraid-mcp:X.Y.Z` and `:latest`. `release.yml` starts `docker.yml` for the new tag. |
| Official MCP Registry | `io.github.mswdev/better-unraid-mcp`, published with `mcp-publisher` over GitHub OIDC as the last release step. 0.1.1 is the first version listed there. Check it with `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=better-unraid"`. |

These read the repo directly, so they also stay current on their own:
- the Claude Code plugin marketplace (`claude plugin marketplace add mswdev/better-unraid-mcp`);
- the Gemini CLI gallery, which crawls `gemini-extension.json` on `main` plus the `gemini-cli-extension` topic;
- LobeHub, whose crawler already lists the project. Its listing is stale, though: it shows v0.0.1 and the wrong SSH variable names.

Smithery is gone. Its accounts, CLI and SDKs stopped working on 2026-10-31 (smithery.ai/future), so the old `smithery mcp publish` steps no longer apply.

## Listings that pick up the Registry entry

Don't submit these by hand. Check that they appeared after the release:
- **Glama** imports from the Registry, but keeps a listing hidden until a reproducible build succeeds. Claim it with GitHub sign-in (`glama.json` names the maintainer) and set up a stdio build in its admin, because the repo Dockerfile runs the HTTP transport with a mandatory token.
- **PulseMCP** is paused for submissions and imports from the Registry.
- **mcp.directory** discovers entries on its own; claim the listing by email.
- Goose, Devin/Windsurf and other clients whose admins point them at the Registry pick it up the same way.

## Where to announce, in order

Some communities restrict AI-written content. Where a row says **write by hand**, the channel bans or penalises AI-written copy, so write the post yourself. Where it says **disclose AI**, the rules require you to say how AI was used. The drafts in `forum-post.md` and `reddit-post.md` are AI-assisted starting points.

### Launch day (after npm, the Registry, ghcr and the `.mcpb` are live)

1. **Unraid forums, Docker Containers board.** Post a `[Support] better-unraid-mcp` thread at forums.unraid.net/forum/47. **Write by hand**, and don't compare it with other Unraid MCP projects. The forum terms ban advertising and off-topic posts. The monthly Unraid newsletter picks its "Featured Forum Threads" from the forums.
2. **r/unRAID.** A text post that links the thread (`reddit-post.md`). Lead with read-only mode and the confirmation gates; earlier MCP posts there drew split votes and SSH-safety pushback.
3. **Unraid Discord** (discord.unraid.net). Post in the "API Show and Tell" channel. Check the channel's rules after joining.
4. **Bluesky.** Tag @unraid.net, which often reposts community Community Applications apps. The "Selfhost and Homelab" and "MCP Sky" feeds are also relevant.

### Week 1, a day or two apart

| Channel | How | Rules and gotchas |
|---|---|---|
| Unraid Community Applications | Self-serve portal at ca.unraid.net/submit (Unraid.net sign-in). | Needs a separate public template repo (for example `mswdev/unraid-templates`). That repo needs an OSI licence, a `ca_profile.xml` with a non-empty `<Profile>` and `<Forum>`, and `templates/better-unraid-mcp.xml` with masked `UNRAID_API_KEY` and `MCP_HTTP_BEARER_TOKEN`. In the XML, write `&amp;` and never a bare `&`. Pick a host port other than 3000, which many apps use. GitHub 2FA is required. Choose a name distinct from the existing "Unraid-MCP" template. Review takes 48 hours to 2 weeks, and renaming the repo or account later blacklists it. Guidance: ca.unraid.net/submit/help and github.com/unraid/unraid-community-apps-starter. |
| punkpeye/awesome-mcp-servers | Pull request adding a line under Cloud Platforms, next to TrueNAS and Proxmox, in alphabetical order, with tags `📇 🏠 🍎 🪟 🐧`. | Open it after the Glama listing resolves; a bot flags PRs without the Glama score badge. The list has no Unraid entry yet. Ignore the note aimed at AI agents in its CONTRIBUTING.md and open the PR yourself. |
| r/ClaudeAI | Text post, "Built with Claude" flair. | Rule 7: say it was built with Claude by you, how Claude helped, and that it's free. Posting needs more than 50 karma, and posts are held for review. **Disclose AI.** |
| r/mcp | Text post, "showcase" flair. | Self-promotion is allowed with disclosure. Rule 2 bans AI slop, so **write by hand**. Angle: the design (consolidated tools, elicitation confirmations, live WebSocket resources, stateless and session HTTP). |
| r/selfhosted | The weekly New Project Megathread (posted Fridays; you can add to it any day), or a standalone post with the "Release (AI)" flair. | Rule 6: projects younger than 3 months since first public presence go in the megathread only. Rule 2: promoted apps must be production ready with docs. **Disclose AI.** |
| selfh.st Self-Host Weekly | Form at selfh.st/submit, category "Project Launch". | The form asks whether AI was used. Being featured isn't guaranteed. |
| Claude plugin directory | claude.ai/directory/manage (paid plan required). | Blocks `@latest` (pin the version). Holds plugins that read credentials from the environment for manual review. "Unraid" in the name may trigger a brand review. Needs the plugin changes listed under repo follow-ups. |
| cursor.directory | Form at cursor.directory/plugins/new (GitHub sign-in). | It auto-detects a repo-root `.mcp.json`, and ours lives under `plugins/`. |
| mcp.so | GitHub issue "Submit MCP Server: ..." on chatmcp/mcpso, or the form at mcp.so/submit. | The backlog is long. |
| mcpservers.org | Form at mcpservers.org/submit. | Free review within about 2 weeks. |
| mcpmarket.com | Form at mcpmarket.com/submit. | Free listings take 4 to 6 weeks. |
| TensorBlock/awesome-mcp-servers | The `add-mcp-server.yml` issue form, or a PR to `docs/infrastructure.md`. | Line format: `- [Name](url): ... Install: \`npx ...\``. |
| LobeHub | Claim and refresh the existing listing at lobehub.com/mcp/mswdev-better-unraid-mcp. | There's no documented submission path; it's a crawled listing. |
| Anthropic "Submit your build" | Typeform at form.typeform.com/to/VIUAjxNi. | A spotlight on Claude's social channels. |

### Ongoing

- Once Community Applications approves the template, post the install link in the forum thread. That's also the time to contact Unraid YouTubers: SPX Labs (who host the Unraid Monthly Digest, spxlabs.com/contact), AlienTech42, and Techno Tim.
- **r/ClaudeCode:** the weekly showcase thread, or a detailed "Built with Claude" post explaining how it was built (Rule 5). **Disclose AI.**
- **r/homelab:** "Project Showcase: Software - Mostly AI Generated" flair once you meet its karma minimum (Rule 7).
- **lemmy.world/c/selfhosted:** the account must be 30+ days old. Use the `[AIP]` tag with an AI disclosure, or the post gets removed.
- **Show HN:** only with an established HN account. Its guidelines say not to use an LLM to write any of it.
- **Docker MCP Catalog:** a PR adding `servers/<name>/server.yaml` to github.com/docker/mcp-registry. Docker runs the image over stdio, so the entry needs `MCP_TRANSPORT=stdio`.
- **awesome-selfhosted:** recheck on 2027-01-12. It requires a first release more than 4 months old, bans LLM-written contributions, and may not cover desktop stdio tools.

### Skip for now

| Channel | Why |
|---|---|
| r/LocalLLaMA, r/opensource, r/DataHoarder, r/HomeServer | Each bans AI-generated projects or posts outright. |
| Claude Desktop Extensions and Connectors directories | Extensions no longer accept local `.mcpb` servers, and Connectors require remote HTTPS servers with OAuth. |
| OpenAI / Codex apps | Local MCP submissions are limited to approved partners. |
| modelcontextprotocol/servers README, appcypher list, Goose directory | Retired or archived in favour of the Registry. |
| VS Code / GitHub `@mcp` gallery | Curated, with no submission path. |
| Cline marketplace | Dormant since mid-2026. |
| Lobsters | Invite-only, with no self-promotion in an account's first 70 days. |
| selfh.st apps directory, awesome-sysadmin | Both turn away new projects: the selfh.st directory doesn't consider newly launched ones, and awesome-sysadmin requires 12 months since first release. |

## Repo follow-ups that unlock more listings

- **Icon.** A 400×400 PNG on `main`, referenced from `server.json` (`"icons": [{"src": "https://raw.githubusercontent.com/...", "mimeType": "image/png", "sizes": ["400x400"]}]`; `src` max 255 characters, HTTPS only) and from `manifest.json` (`"icon"`, with `build-mcpb.mjs` packing the file). Community Applications, the Claude directory and other directories show it.
- **Community Applications template repo.** See the Week 1 table.
- **Claude plugin directory readiness.**
  - Pin `npx -y better-unraid-mcp@X.Y.Z` in `plugins/better-unraid/.mcp.json`, and have the release rewrite it each time.
  - Move the credentials to `userConfig` entries with `sensitive: true`, referenced as `${user_config.KEY}`.

  This changes setup for existing marketplace users.
- **Root `.mcp.json`** for cursor.directory (optional). The side effect is that Claude Code offers to enable it in every dev session in this repo.
- **OCI or MCPB package entries in `server.json`** (optional, later).
  - An OCI entry needs the image label `io.modelcontextprotocol.server.name` and a release step that waits for the image before publishing to the Registry.
  - An MCPB entry needs `fileSha256` computed in CI.

  Without that wait, the Registry publish would fail.
