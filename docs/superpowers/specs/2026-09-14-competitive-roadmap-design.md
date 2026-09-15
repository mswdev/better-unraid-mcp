# Competitive Roadmap Design — better-unraid-mcp

- **Date:** 2026-09-14
- **Status:** Approved by owner (Matt White), pending implementation
- **Scope:** Releases 0.0.4 through 0.0.9, executed autonomously via a single `/goal` run

## 1. Context

A competitive analysis of every known Unraid MCP server found two serious competitors:
**dinglebear-ai/unraid** (Python + Rust, ~180 operations behind one consolidated tool,
WebSocket telemetry, MCP resources, OAuth, wide distribution) and
**ruaan-deysel/unraid-management-agent** (Go on-server root daemon, 126 flat tools,
collector cache, MQTT/Prometheus). We lead the field on safety design, typed codegen,
and the client-side-plus-SSH architecture, but trail on coverage, live telemetry,
connection efficiency, MCP protocol surface (resources/prompts/elicitation), and
security hardening of the HTTP transport.

This roadmap adopts the genuinely good ideas, skips the bad ones, and keeps our
structural advantage: **zero server install** — one API key, optional SSH, nothing
running on the NAS.

## 2. Goals

1. Cover every capability from the competitive analysis that is worth having, via
   GraphQL where the API supports it and SSH where it does not.
2. Be the safest server in the field: structural read-only mode, fail-closed HTTP
   auth, secret redaction, elicitation-based human confirmation.
3. Fix the efficiency gap the owner observed: no reconnect per request; persistent
   SSH, tuned HTTP, caching, and live subscriptions where they make sense.
4. Best-in-field MCP citizenship: resources, prompts, elicitation, subscriptions,
   accurate annotations, structured output.
5. Stay publishable: every phase ships as a tested npm release; the final phase
   delivers the Unraid-forum launch kit.

**Success criteria:** all six releases published to npm; quality gate
(`npm run typecheck && npm run build && npm test && npm run lint`) green on every
merge; every new decision point unit-tested; README documents every new feature;
acceptance-test prompt and decision log delivered at the end.

## 3. Non-Goals (evaluated and deliberately rejected)

| Rejected feature | Reason |
|---|---|
| On-server component (.plg daemon) | Zero-install is our differentiator; SSH reaches everything a daemon can. |
| Autonomous LLM agent loop | The MCP client IS the agent; embedding another is redundant and a liability. |
| MQTT / Home Assistant / Prometheus | Monitoring-platform plumbing, not MCP; large maintenance surface. |
| Fan control & kernel/CPU-governor tuning | Hardware-risky, per-board quirks, support magnet. |
| Expr-based alerting engine | The client model already reasons over metrics; a DSL duplicates it poorly. |
| Docker organizer folders, theme/locale tools | UI organization; near-zero AI value. |
| `updateSshSettings` / settings mutations | Lockout risk; `graphql_mutation` escape hatch covers power users. |
| Service control, unassigned-device mounting | Niche, risky, low demand; revisit on user request. |

## 4. Global Architecture Decisions

- **Client-side only.** npx/npm distribution; GraphQL via `x-api-key`; optional SSH
  channel. No server install ever required.
- **Read-only mode is structural.** `MCP_READ_ONLY=true` prevents mutating tools from
  being *registered* — they are absent from the listing, not rejected at call time.
- **Every tool declares metadata.** The registry records `isMutating` per tool; a
  registry test proves consistency with confirm gates and `destructiveHint`.
- **Elicitation with graceful fallback.** When the client supports
  `elicitation/create`, destructive tools prompt the human; otherwise today's
  `confirm` / `acknowledge_risk` arguments work unchanged. One shared helper.
- **Connections persist.** One kept-alive SSH session (lazy connect, auto-reconnect,
  idle disconnect); keep-alive HTTP agent for GraphQL; `graphql-ws` subscriptions
  feed a snapshot cache in the final phase.
- **All output stays valid.** Truncation always yields parseable JSON envelopes;
  secrets are redacted from every tool result and error.
- **Target clients:** Claude Code, Claude Desktop, Codex (ChatGPT Desktop + CLI).
  Gemini CLI stays documented but is not a test target.
- **Existing patterns hold.** One file per tool, curried `createXHandler` factories,
  hand-written fakes, colocated tests, zod v3 schemas, vendored SDL + codegen.
  New domains get their own directories under `src/tools/`; the 10-source-file cap
  is honored everywhere (splitting `src/tools/docker/` is a 0.0.4 prerequisite).
- **SDK/zod upgrades are not a roadmap item.** Verified 2026-09-14: SDK 1.29.0
  (resolving to 1.30.0, fix-only) supports elicitation (`elicitInput` +
  `getClientCapabilities()`), resources, prompts, subscriptions (low-level
  `setRequestHandler` + manually declared `resources.subscribe` capability),
  progress, and `outputSchema`/`structuredContent`. Zod stays v3. The v2 SDK
  packages (protocol 2026-07-28, zod v4-only) are a post-roadmap migration.
- **Server-initiated traffic needs stdio or stateful HTTP.** Verified against SDK
  source: the current stateless + JSON-response HTTP mode silently drops
  elicitation requests, progress notifications, and resource-updated
  notifications. All of these work over stdio today; over HTTP they require the
  Phase 2 session mode (sessions + SSE). Docs and tool behavior must degrade
  gracefully on stateless HTTP.

## 5. Release Train and Status

Six releases, each: feature branch off `develop` → TDD implementation → quality gate
→ draft PR → CI green → merge → version-bump → merge `develop` into `main` →
auto-publish via the existing `release.yml` trusted-publishing workflow.

**Status table** — the implementing session updates this table as phases complete;
the `/goal` evaluator uses it plus `npm view better-unraid-mcp version` as evidence.

| Phase | Version | Theme | Status |
|---|---|---|---|
| 1 | 0.0.4 | Safe by default + daily drivers | not started |
| 2 | 0.0.5 | Connection architecture | not started |
| 3 | 0.0.6 | Modern MCP surface | not started |
| 4 | 0.0.7 | Coverage: GraphQL | not started |
| 5 | 0.0.8 | Coverage: SSH | not started |
| 6 | 0.0.9 | Live telemetry + launch kit | not started |

## 6. Phase Specifications

### Phase 1 — 0.0.4 "Safe by default"

**Foundation refactors (do first; they unblock everything):**

1. Extract the duplicated two-flag risk gate (`array-action.ts`, `vm-action.ts`,
   `graphql-mutation.ts`) into `_shared/confirm.ts` as `requireRiskAcknowledgement()`.
2. Split `src/tools/docker/` (at the 10-file cap): container lifecycle tools move to
   `src/tools/docker/container/`; colocated tests move with them. Imports must still
   flow downward per the file-organization rules.
3. Registry metadata: `registerAllTools` iterates a table of entries carrying
   `isMutating`; `MCP_READ_ONLY=true` (parsed in `config/env.ts`) skips mutating
   entries. Registry tests assert (a) every tool with a confirm gate or
   `destructiveHint: true` is marked mutating, (b) read-only mode registers zero
   mutating tools.
4. Valid-JSON truncation: replace the string-chop in
   `src/tools/graphql/_shared.ts` (`renderJsonResult`) with an envelope —
   `{"truncated": true, "dropped_chars": N, "hint": "...", "partial": <valid JSON>}`
   — and cap the currently-uncapped `detailed` branch of `formatResponse` with the
   same envelope. Property: `JSON.parse` succeeds on every truncated output.

**Security hardening:**

5. HTTP auth: server refuses to start in HTTP mode without `MCP_HTTP_BEARER_TOKEN`
   unless `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` (double opt-in). Requests without a
   matching `Authorization: Bearer` header get 401; comparison is constant-time
   (`crypto.timingSafeEqual`). DNS-rebinding protection unchanged.
6. Secret redaction: `_shared/redact.ts` applied to all tool text output and error
   messages — key-name matching (case-insensitive: `apikey`, `api_key`, `password`,
   `token`, `secret`, `authorization`) plus value matching for the configured
   `UNRAID_API_KEY` and `UNRAID_SSH_PASSWORD` values and JWT-shaped strings.
7. Rate limiting: client-side token bucket in `src/graphql/` modeling Unraid's
   configured 100 requests / 10 s limit (named constants, with headroom like
   dinglebear's 90-token bucket), waiting up to a bounded time before erroring;
   backoff-and-retry once on HTTP 429. Note (verified 2026-09-14): unraid/api
   configures this throttle but its guard is currently unbound on main — treat
   429 handling as defensive, not a documented server contract.

**Daily-driver tools:**

8. `docker_container_action` gains `restart` — composed GraphQL stop → start
   (the API has no restart mutation), reporting each step's outcome.
9. `mover_action` (new, `src/tools/mover/`) — start/stop via SSH using
   `/usr/local/sbin/mover start` / `mover stop` (always with the explicit
   argument — bare `mover` prints usage on current builds), tier-1 confirm.
   The stop path warns that interrupting the mover can leave partial files on
   the destination. No competitor has this.
10. `system_power` (new, `src/tools/system/`) — reboot / shutdown via SSH using
    `/sbin/reboot` and `/sbin/poweroff` (Unraid's modified rc.6 performs the
    clean array stop; `/usr/local/sbin/powerdown` is a deprecated shim — do not
    use it), tier-2 gate (confirm + acknowledge_risk).
11. `system_health` (new) — one severity-scored rollup (OK/WARN/CRITICAL per
    subsystem: array, parity, disks/SMART/temps, capacity vs. named thresholds,
    UPS, unread alerts, container update backlog; overall = worst). Concise =
    human summary; detailed = per-subsystem JSON.
12. `connection_doctor` (new) — self-test: env config present, GraphQL endpoint
    reachable + latency, API key valid, server version, SSH configured/connectable,
    rate-limit headroom. Read-only; safe to run anytime.

**Acceptance:** quality gate green; registry tests prove read-only filtering; all
truncation paths emit valid JSON; HTTP transport unauthenticated start fails; 0.0.4
on npm.

### Phase 2 — 0.0.5 "Fast"

1. **Persistent SSH.** `SshShellExecutor` becomes lazily-connected and kept alive:
   ssh2 keepalive packets, auto-reconnect on drop, idle disconnect after a named
   default of 90 s (`UNRAID_SSH_IDLE_SECONDS`), bounded concurrent exec channels
   over the single connection. The `ShellExecutor` interface is unchanged, so no
   tool or fake changes.
2. **GraphQL client hardening.** Request timeout (named default 30 s), keep-alive
   undici agent (reused, not per-request), bounded jittered retry for idempotent
   queries only (never mutations).
3. **TTL snapshot cache** (~5 s, named constant) for hot read paths
   (`system_metrics`, `array_status`, `docker_container_list`), keyed by document +
   variables, with `data_age_ms` included in served-from-cache responses.
4. **Progress notifications.** Long `shell_exec` runs and `docker_container_update`
   emit MCP progress notifications when the client supplies a progress token
   (via `extra._meta.progressToken` / `extra.sendNotification`). These reach
   stdio clients and session-mode HTTP clients; stateless JSON-mode HTTP drops
   them (see §4), which is acceptable degradation.
5. **HTTP session mode.** `MCP_HTTP_SESSIONS=true` enables stateful streamable-HTTP
   sessions (SDK `sessionIdGenerator`, session map with idle expiry, DELETE
   teardown, SSE responses instead of `enableJsonResponse`) — prerequisite for
   elicitation and progress over HTTP (Phases 2–3) and subscriptions over HTTP
   (Phase 6). Default remains stateless for backward compatibility.

**Acceptance:** an SSH-backed tool called twice reuses one connection (proven via
fake/spy); no GraphQL call can hang forever; cache serves within TTL and reports
age; 0.0.5 on npm.

### Phase 3 — 0.0.6 "Modern MCP"

1. **Elicitation.** Shared helper: when the connected client declares elicitation
   capability (`getClientCapabilities()?.elicitation`), tier-1/tier-2 gates
   present a real confirmation prompt (with the action description) instead of
   failing; `confirm`/`acknowledge_risk` args remain the non-interactive path and
   the fallback. All gated tools migrate to the helper. Implementation notes:
   pass an explicit request timeout well above the SDK's 60 s default (humans
   read prompts slowly); elicitation only functions over stdio or session-mode
   HTTP, so on stateless HTTP the helper always takes the argument fallback.
2. **Resources.** `unraid://schema` (vendored SDL), `unraid://health` (the
   system_health rollup), `unraid://doctor` (connection self-test).
3. **Prompts.** 3–5 guided workflows: `triage-array-problem`, `find-resource-hog`,
   `safe-container-update`, `health-report`.
4. **Annotations audit.** `idempotentHint` set on every tool; a registry test
   asserts every tool declares the full annotation set. `outputSchema` +
   `structuredContent` for `system_health`, `system_metrics`, `array_status`,
   `docker_container_list`. Note: once a tool declares `outputSchema`, the SDK
   requires `structuredContent` on every non-error result — these tools return
   it in both concise and detailed modes, keeping the text block as the human
   summary (the spec's recommended backward-compatible shape).

**Acceptance:** elicitation path and fallback both unit-tested through the seam;
resources/prompts listed and readable; annotation test passes; 0.0.6 on npm.

### Phase 4 — 0.0.7 "Coverage: GraphQL"

All verified present in the vendored SDL; exact field shapes re-verified against
`schema/unraid.graphql` at plan time per repo rules.

1. **Array disk operations** — add/remove/mount/unmount disk, clear disk statistics
   (`ArrayMutations`); tier-2 gated; array state preconditions checked first.
2. **API key management** (new `src/tools/apikey/`) — list (read), create, update,
   add/remove role, delete (`ApiKeyMutations`); tier-2 gated; descriptions are
   honest that the model is managing credentials; key values redacted in output
   except at creation time (single necessary disclosure, clearly marked).
3. **Notification mark-unread** — `unreadNotification` (our archive tool already
   covers unarchive).
4. **rclone remotes + flash backup** — list remotes (read), trigger a flash/config
   backup via `RCloneMutations`; tier-1 confirm.
5. **Native Unraid plugin install** — `.plg` install via
   `unraidPlugins.installPlugin`; tier-2, `openWorldHint: true`.

**Acceptance:** every new decision point tested against recorded-executor fakes;
gates proven (zero GraphQL calls on refusal); 0.0.7 on npm.

### Phase 5 — 0.0.8 "Coverage: SSH"

All SSH-backed (`requireShell` pattern); each tool probes command availability
(`command -v`) and returns a clear "not available on this server" error; reads are
ungated, mutations gated as noted.

1. **ZFS** (new `src/tools/zfs/`) — `zfs_status` (pools, health, capacity; ARC
   stats read from `/proc/spl/kstat/zfs/arcstats` — the `arcstat` script is
   Python, which stock Unraid lacks), `zfs_dataset_list`, `zfs_snapshot_list`,
   `zfs_snapshot_action` (create/destroy/rollback; tier-2). ZFS is built into
   Unraid 6.12+.
2. **GPU metrics** — `gpu_metrics` with nvidia-smi / intel_gpu_top detection
   (each ships only with its driver plugin; probe and report absence clearly).
3. **Processes** — `process_list`: top processes by CPU/memory with totals.
4. **Disk spin** — `disk_spin` up/down; tier-1. For array/pool disks use
   `emcmd cmdSpinup=diskN` / `cmdSpindown=diskN` so emhttpd performs the spin
   and its tracked spin state stays consistent (calling sdspin directly leaves
   stale UI state); use `sdspin` only for unassigned devices, noting it is an
   hdparm wrapper (ATA only — SAS needs the community plugin).
5. **User Scripts** — `user_script_list` (read), `user_script_run` (tier-2;
   arbitrary code by design, description says so). Scripts live at
   `/boot/config/plugins/user.scripts/scripts/<name>/script` but the flash is
   mounted non-executable (fmask=177 since Unraid 6.8) — replicate the plugin's
   runner: copy to a tmp location, strip CR characters, ensure a shebang, run
   via `bash`. Direct execution of the flash path fails by design.
6. **VM snapshots** — `vm_snapshot_list`, `vm_snapshot_action`; tier-2. Not
   available in GraphQL. MUST use **external** snapshots mirroring Unraid 7's
   own flow (`virsh snapshot-create-as --atomic` with
   `--diskspec <dev>,snapshot=external` / `--disk-only` when stopped; delete
   via `blockcommit --pivot`): internal snapshots fail on raw disks and are
   refused outright for OVMF-firmware VMs, which is the typical Unraid setup,
   and bare `snapshot-revert` would corrupt Unraid 7's snapshot chains. This is
   Phase 5's highest-complexity item; if implementation risk proves too high,
   descoping revert/delete (keeping list + create) is a pre-authorized
   decision-log call.
7. **SMART deep report** — `disk_smart_report`: full smartctl attributes for one
   disk (read).

**Acceptance:** all tools degrade cleanly without SSH and on missing binaries
(tested via fakes); quoting uses `quoteForShell` everywhere; 0.0.8 on npm.

### Phase 6 — 0.0.9 "Live + Launch"

1. **Subscription client.** `graphql-ws` over WebSocket to the same `/graphql`
   endpoint (verified: unraid/api configures Apollo with the modern graphql-ws
   library, wire subprotocol `graphql-transport-ws`), authenticated by sending
   `{"x-api-key": "<key>"}` in the `connection_init` payload (the API's auth
   guard merges connectionParams into request headers), feeding the snapshot
   cache. Confirmed available subscriptions: `dockerContainerStats`,
   `logFile(path)`, `systemMetricsCpu/Memory/Network/Temperature`,
   `arraySubscription`, `parityHistorySubscription`, `upsUpdates`,
   `notificationAdded`.
2. **MCP resource subscriptions.** Subscribable resources for parity progress,
   docker stats, system metrics, and log follow (`unraid://logs/{path}`), with
   `listChanged` notifications. Requires HTTP session mode when on HTTP transport.
3. **docker_stats upgrade.** Prefer subscription-fed data with the SSH path as
   fallback; response says which source served it.
4. **Launch kit.** README overhaul (per-client install, security guidance,
   read-only quickstart for cautious users, feature tour); draft Unraid forum
   announcement post at `docs/launch/forum-post.md`.

**Acceptance:** subscription lifecycle (connect, data, reconnect, fallback) tested
against a fake WS feed; docs complete; 0.0.9 on npm.

## 7. Quality and Process (all phases)

- **TDD per repo rules** (`.claude/rules/testing.md`): hand-written fakes; new fakes
  added to `_shared/test-support.ts` (persistent-shell spy, fake subscription feed);
  Arrange-Act-Assert; every decision point tested.
- **Code style limits are hard:** ≤25-line methods, ≤2 nesting levels, ≤3 params,
  no magic numbers, JSDoc on all exports.
- **Quality gate before every commit:**
  `npm run typecheck && npm run build && npm test && npm run lint`.
- **Conventional commits**; one logical change per commit.
- **No-touch zones stand:** `schema/unraid.graphql` (regen only), `src/types/unraid`
  (codegen only), CI workflows (explicit owner approval required for any change).
- **Docs move with code:** README env table and feature docs update in the same PR
  as the feature.

## 8. Kickoff: the `/goal` Run

### Merge autonomy grant

On 2026-09-14 the project owner granted, for the scope of this roadmap: Claude may
mark roadmap draft PRs ready for review, merge them into `develop` once CI is green
and the quality gate passes locally, perform the `develop` → `main` release merges
(triggering npm auto-publish), and proceed through all phases without pausing for
per-merge approval. CI workflow files remain a no-touch zone.

### Decision log

Judgment calls that would normally warrant asking the owner are made with best
judgment, recorded in `docs/superpowers/specs/roadmap-decisions.md` as they happen
(what was decided, why, alternatives considered, whether owner input is still
wanted), and presented in the final report. Only decisions genuinely needing owner
input are raised as questions at the end.

### Acceptance-test prompt

The final deliverable includes `docs/superpowers/specs/roadmap-acceptance-test.md`:
a self-contained prompt the owner pastes into a fresh session (with the MCP server
connected to a real Unraid box) that exercises every new capability — read tools,
gated mutations (against safe targets), read-only mode, HTTP auth, elicitation,
resources, prompts, subscriptions, SSH degradation — and produces a structured
pass/fail report suitable for handing back to implement fixes.

### Per-phase loop

For each phase, in order: write the implementation plan (superpowers writing-plans)
from this spec → branch `feature/0.0.X-<theme>` off `develop` → implement via TDD →
quality gate → draft PR into `develop` (conventional description) → CI green → mark
ready + merge → bump version + update status table in this spec → merge `develop`
into `main` → verify `npm view better-unraid-mcp version` shows the new release →
next phase.

### The goal statement

```text
/goal The competitive roadmap in docs/superpowers/specs/2026-09-14-competitive-roadmap-design.md is fully delivered: the spec PR mswdev/better-unraid-mcp#31 is merged into develop; the status table in that spec shows all six phases (0.0.4 through 0.0.9) marked "released"; `npm view better-unraid-mcp version` prints 0.0.9; the quality gate (npm run typecheck && npm run build && npm test && npm run lint) exits 0 on both develop and main; every phase followed the per-phase loop in section 8 of the spec (implementation plan written — Phase 1's already exists at docs/superpowers/plans/2026-09-14-0.0.4-safe-by-default.md — then TDD implementation, draft PR into develop, CI green, marked ready, merged, version bumped, released via merge to main) with no phase skipped; docs/superpowers/specs/roadmap-decisions.md exists and records the judgment calls made during the run; and docs/superpowers/specs/roadmap-acceptance-test.md exists containing the acceptance-test prompt described in the spec, with the final summary presenting the decision log (flagging any decisions that still need owner input) plus that acceptance-test prompt. Constraints: never hand-edit schema/unraid.graphql or src/types/unraid (regenerate only); never modify .github/workflows; never log or output UNRAID_API_KEY; follow .claude/CLAUDE.md and .claude/rules/ throughout; the merge autonomy granted in section 8 of the spec applies (mark roadmap draft PRs ready and merge them on green CI, including develop-to-main release merges).
```

Run it from a session in this repo with auto permission mode so merges and
publishes proceed unattended. The goal survives session resumes; re-running the
status helper (`git log`, the status table, `npm view`) re-orients any new session.

## 9. Post-Roadmap Reminders (owner asked to be reminded)

Explicitly deferred, in suggested order:

1. **Docker image** (ghcr) for the HTTP transport deployment style.
2. **Official MCP Registry listing.**
3. Claude Code plugin marketplace / Smithery entries.
4. **Daily upstream schema-drift CI job** against `unraid/api` (needs owner
   approval — CI is a no-touch zone).
5. Revisit skipped coverage on user demand: service control, unassigned devices,
   NUT-specific UPS support, metric history.

## 10. References

- Competitive analysis conversation (2026-09-14): dinglebear-ai/unraid,
  ruaan-deysel/unraid-management-agent, jmagar/unraid-mcp (same project as
  dinglebear), TheTechChild, theippenguin, lwsinclair forks/servers.
- Vendored SDL: `schema/unraid.graphql` (verified 2026-09-14 for: ArrayMutations
  disk ops, ApiKeyMutations, RCloneMutations, unraidPlugins, Subscription fields;
  absent: docker restart, system power, VM snapshots, mover control).
- Claude Code `/goal` documentation: https://code.claude.com/docs/en/goal
  (verified 2026-09-14: evaluator-judged completion, session persistence, no
  auto-merge, permission-mode interaction).
- MCP SDK verification (2026-09-14): @modelcontextprotocol/sdk 1.29.0/1.30.0
  tarballs + docs — elicitation/resources/prompts/subscriptions/progress all
  present in 1.x (protocol 2025-11-25); stateless JSON-mode HTTP drops
  server-initiated messages; v2 SDK packages are post-roadmap.
- Unraid verification (2026-09-14): unraid/api and unraid/webgui sources —
  graphql-ws on /graphql with connection_init auth; mover/reboot/spin/User
  Scripts/virsh command corrections captured in Phases 1 and 5; the API's
  100 req/10 s throttle is configured but its guard is unbound on main.
