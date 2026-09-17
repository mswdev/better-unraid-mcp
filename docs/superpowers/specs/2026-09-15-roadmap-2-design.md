# Roadmap 2 Design — better-unraid-mcp 0.0.11 → 0.1.0

- **Date:** 2026-09-15
- **Status:** Approved by owner (Matt White); in execution (kickoff 2026-09-17)
- **Scope:** Releases 0.0.11 through 0.1.0, executed autonomously via a single `/goal` run in a fresh session
- **Predecessor:** `2026-09-14-competitive-roadmap-design.md` (0.0.4–0.0.9, fully delivered; plus the 0.0.10 review-hardening follow-up)

## 1. Context

Roadmap 1 delivered the safety, performance, MCP-surface, coverage, and live-telemetry
releases; a post-hoc code review (decision D17) hardened them in 0.0.10. What remains:

1. **Live validation.** Everything so far is proven against fakes and the vendored SDL,
   never against real hardware. The owner is running the acceptance-test prompt
   (`roadmap-acceptance-test.md`) against the real server ("Deepwater", Unraid 7.3,
   i9-14900K) and will supply the structured pass/fail report.
2. **Owner-requested features** that need SSH because the GraphQL API lacks them
   (verified 2026-09-15 against the vendored SDL: NO share mutations, NO service
   mutations — `Query.services` is a vestigial read — and NO unassigned-devices
   surface at all): share management, service control, unassigned devices, plus
   metric history, flash backup, VM snapshot revert/delete, and DX quick wins.
3. **Platform migration.** The MCP TS SDK v2 packages (protocol 2026-07-28) and zod v4.
4. **Launch & distribution**, deliberately LAST per the owner: forum post, MCP
   Registry, marketplace/Smithery, MCPB bundle, Docker image.

## 2. Goals and Success Criteria

- Every acceptance-test FAIL is fixed (or explicitly decision-logged as won't-fix) in 0.0.11.
- All planned releases published to npm; quality gate (`npm run typecheck && npm run
  build && npm test && npm run lint`) green on every merge; every decision point
  unit-tested against hand-written fakes; README + `.env.example` + GitHub release
  notes updated in the same PR as each feature (release notes are now a standing
  deliverable — write real ones when editing each `gh release`).
- SSH-backed config-mutating features (shares, services, unassigned devices) ship
  only after their **live validation step** (see §5) passes on the real server.
- The run ends with `npm view better-unraid-mcp version` = `0.1.0` and the
  distribution phase complete.

## 3. Non-Goals (carried forward + new)

Rejected in Roadmap 1 and still rejected: on-server daemon, MQTT/Home
Assistant/Prometheus bridges, fan/kernel tuning, alerting DSL, embedded agent loop,
`updateSshSettings`. New: Docker organizer folders (`createDockerFolder` etc. exist in
the SDL but are UI organization, near-zero AI value); user-account management
(niche, lockout-adjacent); rclone/flash-backup via the API (still a stub upstream —
D9; this roadmap ships an SSH flash backup instead).

## 4. Inputs Required Before/During the Run

1. **Acceptance-test report** — the owner pastes the structured pass/fail table
   (produced by `roadmap-acceptance-test.md` in a separate session) into the kickoff
   session. Phase 0 is driven entirely by it.
2. **CI no-touch-zone approvals** (the kickoff prompt grants these explicitly, since
   `.github/workflows` edits otherwise require owner sign-off):
   - a scheduled **schema-drift job**: weekly `npm run schema:update && npm run
     generate` against upstream `unraid/api`, opening an issue/PR when the vendored
     SDL drifts — so API changes are caught before users hit them;
   - **Dependabot** config for npm dependency/security updates.
3. **Merge autonomy re-grant** — same terms as Roadmap 1 §8 (mark roadmap draft PRs
   ready, merge on green CI, perform develop→main release merges), granted in the
   kickoff prompt for the scope of this roadmap.

## 5. Release Train

Same per-phase loop as Roadmap 1: write the phase implementation plan
(superpowers:writing-plans) → branch off `develop` → TDD → quality gate → draft PR
into `develop` → CI green → ready + merge → version bump + status table update →
develop→main release PR → verify npm. Decision log continues in
`roadmap-decisions.md` (D18+). **New rule for this roadmap:** any tool that WRITES
host configuration over SSH (Phase 3) gets a live-validation step before its
implementation plan is finalized: read the relevant `unraid/webgui` source, then
probe read-only on the real server (via the MCP connection's `shell_exec`/`file_read`
with owner-visible commands) to confirm file formats and reload commands. Findings go
in the phase plan; if validation fails, the item is descoped with a decision-log entry.

**Status table** (the implementing session updates this):

| Phase | Version | Theme | Status |
|---|---|---|---|
| 0 | 0.0.11 | Acceptance-test triage | released |
| 1 | 0.0.12 | DX quick wins | released |
| 2 | 0.0.13 | Backup + VM snapshot completion | released |
| 3 | 0.0.14 | Coverage: host configuration (SSH) | released |
| 4 | 0.0.15 | Metric history | released |
| 5 | 0.1.0 | SDK v2 + zod v4 migration | in progress |
| 6 | — | Launch & distribution | not started |

## 6. Phase Specifications

### Phase 0 — 0.0.11 "Acceptance-test triage"

Input: the owner's pass/fail report. For each FAIL: reproduce against fakes where
possible, fix TDD-style, and record upstream quirks discovered on real hardware in
the project memory conventions (the `reference-unraid-*` docs pattern: what the API
actually returned vs. what the SDL implies). For each SKIPPED item that a config
change could unlock, note it in the final report. Items that are upstream bugs get
decision-log entries and honest tool-copy updates rather than workarounds, unless a
workaround is safe and small. Release 0.0.11 even if the diff is small — it is the
"validated on real hardware" release, and the release notes should say so.

### Phase 1 — 0.0.12 "DX quick wins"

1. **`doctor` CLI mode** — `npx better-unraid-mcp doctor` (argv check in
   `src/index.ts` before transport startup) runs the connection-doctor checks and
   prints them to stdout with a non-zero exit on failure. Zero new deps; reuses
   `runConnectionDoctor`. Docs: README quickstart gains "verify your setup" step.
2. **Version-skew check** — `connection_doctor` (and the CLI) compares the server's
   reported API version to the vendored schema's version (record the SDL's source
   version at `npm run schema:update` time in a generated constant; if none is
   recorded yet, capture `info.versions.core.api` expectations per release) and
   emits a `warn` check naming both versions on mismatch.
3. **Local dry-run validation** — `graphql_query`/`graphql_mutation` validate the
   parsed document against the vendored SDL (graphql-js `buildSchema` +
   `validate`, lazily built once) BEFORE sending; validation errors return the
   graphql-js messages (they include did-you-mean suggestions). Add an optional
   `dry_run: true` argument that stops after validation and reports "valid".
4. **`notification_archive` batch parity check** — small: confirm archive/unarchive
   arrays vs single-id paths all surface per-id failures honestly (review D17 noted
   upstream batch swallows errors; tool copy should say so if true).

### Phase 2 — 0.0.13 "Backup + VM snapshot completion"

1. **`flash_backup` (SSH, tier-2)** — replaces the descoped API backup (D9): create
   a timestamped tar of `/boot` (config only by default: `/boot/config`; `full: true`
   for the whole flash) into a target share directory (default
   `/mnt/user/<share>/flash-backups/`, `share` argument required, path-validated),
   excluding nothing secret since it stays on the owner's own array — but the tool
   copy MUST say the archive contains keys/passwords and should not leave the
   server. Verify with `tar -tzf` afterwards and report size + path. Prune option:
   `keep` (default unlimited, named constant when set).
2. **VM snapshot revert/delete (tier-2)** — completes D12. Delete: per-disk
   `virsh blockcommit <vm> <disk> --active --pivot --wait` orchestration for a
   running VM (metadata-only snapshot removal + file cleanup when stopped);
   revert: only for STOPPED VMs, by copying/pointing the domain back at the base
   images per Unraid 7's flow. Implementation plan MUST re-verify the exact flow
   against `unraid/webgui`'s VM snapshot code (live-validation rule §5) — if the
   flow can't be made chain-safe, keep the descope (pre-authorized) and say so in
   the tools' descriptions.

### Phase 3 — 0.0.14 "Coverage: host configuration (SSH)"

All items REQUIRE the §5 live-validation step first; each degrades cleanly when its
substrate is missing. The GraphQL API has none of these (verified 2026-09-15).

1. **Service control** — `service_list` (status of the standard set: samba, nfs,
   sshd, docker, libvirt, tailscale if present — probe `/etc/rc.d/rc.<name>` and
   report running state) and `service_action` (tier-2: `restart` only by default;
   `stop` demands an extra `allow_stop: true` because stopping smb/nfs cuts off
   shares, and stopping docker/libvirt is refused outright — that's what
   array_action and the UI are for). Uses `/etc/rc.d/rc.X <verb>`.
2. **Unassigned devices** — `unassigned_list` (read: `lsblk -J -o ...` minus
   array/pool members cross-referenced from `disk_list` data or `/proc/mdstat` +
   pool configs; shows partitions, fs, mount state) and `unassigned_action`
   (tier-2 mount/unmount): prefer the Unassigned Devices plugin's
   `/usr/local/sbin/rc.unassigned mount|umount <dev>` when installed (probe), else
   refuse with guidance (no raw `mount` fallback — UD handles mountpoint naming,
   SMB shares, and cleanup).
3. **Share management** — `share_create` / `share_edit` / `share_delete` (all
   tier-2). Mechanism (to be confirmed in validation): a user share is
   `/boot/config/shares/<name>.cfg` (allocator, floor, split level,
   `shareUseCache`/`shareCachePool`, export flags) + the share directory appearing
   on a data disk; changes take effect via emhttpd (`emcmd` share reload — exact
   command from webgui source). Scope guardrails: `share_delete` only removes the
   CONFIG (never data; it must refuse if asked to delete contents and say where
   data lives); `share_edit` exposes a validated subset (allocation method, cache
   pool/mode, comment, SMB export on/off + security mode); names validated
   `^[A-Za-z0-9._ -]+$` and non-reserved (flash, boot, etc.).

### Phase 4 — 0.0.15 "Metric history"

**Recorder** — an opt-in sampling loop (`MCP_METRICS_HISTORY=true`, default off)
that starts the graphql-ws feed subscriptions for cpu/memory/network (reusing
`SubscriptionFeed`) at server start and downsamples into per-topic ring buffers
(named constants: 30 s resolution, 24 h retention → 2880 points/topic; memory-bounded,
process-lifetime only — no disk persistence, documented honestly).
**`metrics_history` tool** (read-only) — returns a downsampled series for a topic
over a requested window (`window_minutes`, max = retention) with honest gaps where
samples are missing; concise mode renders a compact min/avg/max table per bucket.
**`unraid://live/history` resource** mirrors it. When the recorder is off, tool and
resource say exactly how to enable it. Registry/read-only/annotation rules as usual.

### Phase 5 — 0.1.0 "SDK v2 + zod v4 migration"

The parked platform migration, as its own release because it touches every tool:

1. Move `@modelcontextprotocol/sdk` 1.x → the v2 packages (protocol 2026-07-28).
   Verified 2026-09-14: v2 is zod v4-only and restructures the server API. Plan
   step one is a fresh verification of the v2 API shape (registerTool/resources/
   prompts/elicitation/subscription equivalents, streamable-HTTP session API) —
   pin exact versions in the phase plan.
2. zod 3 → 4 across all `inputSchema`/`outputSchema` declarations (58+ tools) —
   mostly mechanical (`z.enum`/`.default()`/`.optional()` survive; check
   `z.record`, error maps, and the SDK's raw-shape expectations).
3. Behavior must be provably unchanged: the full test suite is the contract — it
   should pass with minimal assertion edits; any behavioral delta gets a
   decision-log entry.
4. Node floor review: if the v2 SDK (or undici/ssh2 majors) require Node ≥ 22,
   bump `engines`, drop the `ws` dependency in favor of the global WebSocket, and
   note the breaking change in the release notes (this is the 0.1.0 justification
   alongside the protocol bump).

### Phase 6 — Launch & distribution (after ALL features, per owner)

No version bump of its own (ships against 0.1.0):

1. **Forum post** — finalize `docs/launch/forum-post.md` (update the tool count and
   feature list to 0.1.0 reality) and hand the owner the final text to post.
2. **Official MCP Registry** listing (server.json / registry PR per current process
   — verify the process at execution time).
3. **Claude Code plugin marketplace + Smithery** entries.
4. **MCPB bundle** — a `.mcpb` one-click install for Claude Desktop users without
   Node (bundle the built server + Node runtime per the MCPB spec; new CI artifact
   allowed under the §4 approval).
5. **Docker image (ghcr)** for the HTTP-transport deployment style (workflow
   addition under the §4 approval), README section for it.
6. **README demo GIF** near the top + badges refresh; final README pass against
   0.1.0 reality.
7. Schema-drift job + Dependabot land here too (already approved via §4).

## 7. Kickoff Prompt (run in a fresh session, auto permission mode)

Paste the acceptance-test report into the same message, replacing the placeholder.

```text
/goal Roadmap 2 in docs/superpowers/specs/2026-09-15-roadmap-2-design.md is fully delivered: the status table shows phases 0–5 "released" and phase 6 "done"; `npm view better-unraid-mcp version` prints 0.1.0; the quality gate (npm run typecheck && npm run build && npm test && npm run lint) exits 0 on develop and main; every phase followed the §5 loop (implementation plan written via superpowers:writing-plans, TDD, draft PR into develop, CI green, ready, merged, version bumped, released via develop→main merge) with no phase skipped; Phase 0 addressed every FAIL in the acceptance-test report below (fix or decision-logged won't-fix); the Phase 3 tools shipped only after their live-validation steps passed (read-only probes on my real server via the connected better-unraid MCP tools are pre-approved; any WRITE outside the per-phase loop is not); GitHub release notes written for every release; the decision log (roadmap-decisions.md, D18+) records all judgment calls; and the final summary presents the decision log and the phase-6 handoff items (forum post text to publish, registry/marketplace listing status). Grants for this run: the Roadmap-1 §8 merge autonomy applies to this roadmap's PRs and release merges; I approve the two .github/workflows additions named in §4 (schema-drift job, Dependabot) and the MCPB/Docker release-workflow artifacts in Phase 6 — no other workflow changes. Constraints: never hand-edit schema/unraid.graphql or src/types/unraid (regenerate only); never log or output UNRAID_API_KEY or SSH credentials; follow .claude/CLAUDE.md and .claude/rules/ throughout; Phase 3 config-writing tools must refuse rather than guess when live validation is inconclusive.

ACCEPTANCE TEST REPORT:
<paste the pass/fail report here>
```

## 8. References

- Predecessor spec + decision log D1–D17; `roadmap-acceptance-test.md`.
- SDL verification 2026-09-15: Mutation root has NO share/service/unassigned
  fields; `Query.services` returns vestigial `Service` nodes; Docker organizer
  mutations exist but are rejected (non-goal).
- Live server: "Deepwater", Unraid 7.3, kernel 6.18.38 (probed 2026-09-15 via the
  connected MCP server, which was running the 0.0.3 toolset at the time — the
  kickoff session should confirm the connection is on ≥ 0.0.10).
- SDK v2 verification notes in Roadmap 1 §4 (2026-09-14): v2 = protocol
  2026-07-28, zod v4-only; re-verify at Phase 5 plan time.
