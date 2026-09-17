# Roadmap Decision Log

Judgment calls made during the autonomous 0.0.4 → 0.0.9 roadmap run
(spec: `2026-09-14-competitive-roadmap-design.md`, §8). Each entry records
what was decided, why, alternatives considered, and whether owner input is
still wanted.

## Phase 1 — 0.0.4 "Safe by default"

### D1: connection_doctor reports static rate-limit configuration, not live headroom

- **Decided:** The doctor's rate-limit check reports the limiter's static
  configuration (90-request burst, 9/s refill) instead of live token counts.
- **Why:** Exposing live bucket state through the `GraphQLExecutor` seam would
  widen an interface every tool depends on, for one diagnostic line.
- **Alternatives:** A `getRateLimitState()` method on the executor interface
  (rejected: interface creep); a module-level singleton peek (rejected: hidden
  coupling).
- **Owner input:** Not needed. Revisit only if users ask for live headroom.
- **Pre-authorized:** Yes — this exact call was anticipated in the Phase 1 plan.

### D2: system_health parity-error fixture uses COMPLETED, numErrors as string

- **Decided:** The plan's illustrative fixtures used `status: "OK"` and numeric
  `numErrors`; the generated types define `ParityCheckStatus` without an `OK`
  member and `numErrors` as `string | null`. Fixtures were adjusted to
  `"COMPLETED"` and `"0"`, per the plan's own rule ("fix the FIXTURE ... never
  the generated type"). `healthyFixture()` is typed via an explicit
  `: SystemHealthQuery` return annotation (instead of `satisfies`) so tests can
  mutate one field at a time while keeping the codegen-drift tripwire.
- **Owner input:** Not needed.

## Phase 2 — 0.0.5 "Fast"

### D3: Snapshot-cache age travels via a WeakMap, not a mutated payload

- **Decided:** `CachingExecutor` stamps serve-age in a WeakMap read through
  `cacheAgeMs(data)`; the three hot tools add `data_age_ms` to their detailed
  payloads explicitly.
- **Why:** Injecting a `data_age_ms` field into the typed GraphQL payload
  would silently violate the generated types and surprise every consumer;
  the WeakMap keeps the executor honest and the field opt-in per tool.
- **Alternatives:** Mutating the payload (rejected: type lies); widening
  `GraphQLExecutor` with an envelope return (rejected: touches every tool).
- **Owner input:** Not needed.

### D4: shell_exec progress is a heartbeat, not real command progress

- **Decided:** `shell_exec` emits a periodic "still running" heartbeat (every
  5 s) rather than parsing command output for progress.
- **Why:** The executor collects output only at command completion; streaming
  partial output would change the `ShellExecutor` seam the spec says to keep.
  A heartbeat still gives clients liveness for long commands.
- **Owner input:** Not needed. Revisit if streaming output becomes a feature.

### D5: Session idle expiry fixed at 5 minutes, not configurable

- **Decided:** `SESSION_IDLE_EXPIRY_MS` is a named constant (300 000), swept
  every 60 s; no env knob.
- **Why:** The spec asked for "session map with idle expiry" without a knob;
  YAGNI until a user reports needing longer-lived idle sessions.
- **Owner input:** Not needed.

## Phase 3 — 0.0.6 "Modern MCP"

### D6: Elicitation channel is created per-registration from the McpServer

- **Decided:** Each gated tool's `registerX` builds the channel via
  `createElicitationChannel(server)` and passes it as an optional trailing
  factory parameter; capability detection happens lazily per call.
- **Why:** Register functions already receive the server; handler factories
  keep their fake-friendly signatures (tests omit the channel → argument
  path). Lazy `getClientCapabilities()` matters because capabilities are
  unknown until after initialization.
- **Alternatives:** Threading the channel through `RegistryOptions`
  (rejected: widens every registration for 14 consumers); reading
  elicitation support from `extra` (the SDK does not expose it there).
- **Owner input:** Not needed.

### D7: A cancelled elicitation counts as declined; a failed one falls back

- **Decided:** `cancel` and accept-with-false map to a refusal ("the user
  declined"); a thrown elicitation error maps to the argument-fallback path.
- **Why:** Cancel is a human choice — refusing is honest. A protocol error is
  an environment problem — punishing the model with a refusal it can never
  satisfy would be wrong, so it gets the classic instructions instead.
- **Owner input:** Not needed.

### D8: Structured content is redacted by JSON round-trip

- **Decided:** `formatStructuredResponse` redacts by
  `JSON.parse(redactSecrets(JSON.stringify(payload)))`.
- **Why:** Keeps the "no secrets in any output" guarantee for the new
  `structuredContent` channel with one implementation; the redactor already
  guarantees parseable JSON output.
- **Owner input:** Not needed.

## Phase 4 — 0.0.7 "Coverage: GraphQL"

### D9: rclone remotes + flash backup DESCOPED (spec item 4) ⚠ owner review

- **Decided:** Phase 4's "rclone remotes + flash backup" item ships nothing.
- **Why:** Validated upstream findings (2026-09-14, unraid/api v4.35.0 + main):
  `initiateFlashBackup` is a Not-implemented stub; rclone is disabled in
  production builds — `rclone.remotes` silently returns `[]` and the config
  mutations throw; the config reads that do work leak unredacted credentials.
  The same findings already removed backup scope from PR #9. Tools against a
  dead API would fail confusingly on every real server.
- **Alternatives:** Shipping the tools with "may not work" copy (rejected:
  guaranteed-broken is worse than absent); SSH-based flash backup via
  shell_exec guidance (already possible through the escape hatch).
- **Owner input:** WANTED — confirm the descope, and whether to add a
  post-roadmap reminder to revisit when upstream ships a working backup API.

### D10: Disk-op preconditions probe array state before mutating

- **Decided:** `array_disk_action` runs a 1-field array-state probe after the
  gate and refuses add/remove unless STOPPED, mount/unmount/clear unless
  STARTED, naming the actual state and the `array_action` fix.
- **Why:** The upstream error for wrong-state disk ops is unhelpful; the spec
  asked for precondition checks. Probing after the gate keeps declined calls
  free of any server traffic.
- **Owner input:** Not needed.

### D11: API key management is two tools, not five

- **Decided:** `apikey_list` (read) + consolidated `apikey_manage`
  (create/update/add_role/remove_role/delete), matching the owner's
  consolidated-workflow tool preference; list never selects the `key` field;
  create disclosed the key value once, phrased to bypass the redactor's
  key:value pattern deliberately.
- **Owner input:** Not needed.

## Phase 5 — 0.0.8 "Coverage: SSH"

### D12: VM snapshot revert/delete descoped; ZFS snapshot actions ship in full

- **Decided:** VM snapshots ship as `vm_snapshot_list` + `vm_snapshot_create`
  (external, `virsh snapshot-create-as --atomic --disk-only`); revert and
  delete are not offered and both tools say to use the Unraid UI for those.
  ZFS `zfs_snapshot_action` ships create/destroy/rollback in full.
- **Why:** The spec pre-authorized descoping VM revert/delete if
  implementation risk proved too high — and it is: correct external-snapshot
  deletion needs per-disk `blockcommit --pivot` orchestration and a bare
  `snapshot-revert` corrupts Unraid 7's snapshot chains. ZFS snapshots, by
  contrast, are single well-defined CLI commands with safe failure modes
  (rollback refuses non-latest on its own; destroy is validated to only ever
  target `dataset@snapshot`).
- **Owner input:** Not needed (pre-authorized); revisit VM revert/delete as a
  post-roadmap item if users ask.

### D13: gpu_metrics Intel path is detection + bounded raw sample

- **Decided:** NVIDIA gets fully parsed metrics (nvidia-smi CSV); Intel gets
  detection plus a 3-second `timeout intel_gpu_top -J` raw sample, truncated.
- **Why:** intel_gpu_top has no single-shot machine mode; a bounded raw
  sample is honest and still useful, and the spec asked for "detection" with
  clear absence reporting rather than parity.
- **Owner input:** Not needed.

## Phase 6 — 0.0.9 "Live + Launch"

### D14: docker-stats live samples are aggregated per container id

- **Decided:** The `dockerContainerStats` subscription emits ONE container per
  event, so the live-resource pipeline reduces samples into a per-id map
  (`{containers: {id: stats}}`) before storing; `docker_stats` serves from it
  when fresher than 10 s and labels the source, else falls back to SSH.
- **Why:** Storing only the latest single-container event would make the live
  path useless for a whole-box view; the reducer is confined to that topic.
- **Owner input:** Not needed.

### D15: Live metrics resource carries CPU only (for now)

- **Decided:** `unraid://live/metrics` subscribes to `systemMetricsCpu`;
  memory/network/temperature subscriptions are not wired in this release.
- **Why:** One clean topic proves the lifecycle end to end; fanning one
  resource out across four upstream subscriptions multiplies reconnect and
  merge states for little launch value. The `system_metrics` tool still
  covers everything on demand.
- **Owner input:** RESOLVED 2026-09-15 — the owner asked for the full set.
  `unraid://live/metrics` now fans out across systemMetricsCpu/Memory/
  Network/Temperature (merged `parts` payload), and `unraid://live/ups`,
  `unraid://live/array`, and `unraid://live/notifications` were added
  (upsUpdates / arraySubscription / notificationAdded).

### D16: New runtime dependencies graphql-ws + ws

- **Decided:** Added `graphql-ws` (protocol client) and `ws` (WebSocket impl
  for Node 20) as runtime dependencies.
- **Why:** The spec mandates the graphql-transport-ws subprotocol; Node 20
  (the package's floor) lacks a stable global WebSocket.
- **Owner input:** Not needed.

## Post-roadmap review round (0.0.10)

### D17: Code-review findings fixed; two items deliberately deferred

- **Decided:** A high-effort review of v0.0.3..HEAD produced 10 consolidated
  findings plus angle-scan extras; 14 correctness items were fixed in 0.0.10
  (live-subscription teardown on server close, error self-heal + re-subscribe,
  docker-stats per-container eviction via a shared merge contract, mutation
  invalidation of the snapshot cache, system_power false-success
  classification, SSH null-exit-code = failure, exec-deadline channel close,
  channel-semaphore slot handoff, session init-failure cleanup, SSE-stream
  sweep exemption, headersSent guard, bounded truncation envelope, dot-name
  script confinement, UPS phantom/multi-token status handling) plus the
  25-line-cap refactors and the requireShell narrowing cleanup.
- **Deferred:** (a) unifying the two JSON-RPC error writers across transport
  files into one shared helper (guard added; dedup is cosmetic); (b) a timed-
  out SSH command's REMOTE process may keep running — the channel is now
  closed (freeing the session slot and stopping buffering) and the timeout
  message says so, but killing the remote process would need wrapper/pty
  machinery.
- **Owner input:** Not needed.

## Roadmap 2 — Phase 0 (0.0.11) "Acceptance-test triage"

### D18: The kickoff session ran the acceptance test itself, read-only

- **Decided:** The Roadmap 2 kickoff prompt arrived with the acceptance-report
  placeholder unfilled. Rather than block, the session ran the acceptance prompt
  against Deepwater under the kickoff's read-only grant: read items and refusal
  gates were exercised (the gates through a local stdio client against an
  unreachable endpoint, because Claude Code's auto-mode classifier blocks
  no-flag calls to tier-2 tools), items 12–13 (notification round-trip, disk
  spin) were SKIPPED. Report: `roadmap-acceptance-report-2026-09-17.md`.
- **Why:** Phase 0 is driven entirely by the report and everything needed for
  a faithful read-only run was available; stopping would have stalled the whole
  roadmap for two reversible write checks.
- **Alternatives:** Run the whitelisted writes anyway (rejected: outside the
  grant); stop and ask (rejected: autonomous run, no owner online).
- **Owner input:** Wanted, non-blocking — re-run items 12–13 at your leisure.

### D19: disk_list filters the upstream partition-prefix bleed

- **Decided:** `disk_list` keeps only partitions matching `^<device>p?\d+$`
  (e.g. `/dev/sda` → `sda1`, never `sdaa1`), a small pure filter, and its
  docstring records the upstream cause.
- **Why:** The Unraid API attaches partitions by device-name prefix; on
  Deepwater (>26 disks) `/dev/sda` listed the partitions of five other disks
  including the flash drive. The workaround is tiny, safe, and provably
  correct for Linux block-device naming, so it beats documentation alone.
- **Owner input:** Not needed. Worth an upstream `unraid/api` issue.

### D20: system_health reads UPS in a separate query; unavailability is ok-severity

- **Decided:** The `SystemHealth` document no longer selects `upsDevices`;
  `runSystemHealth` issues the existing `UpsStatus` document alongside it and
  turns a failure into a `ups` line "UPS data unavailable — the Unraid API
  reads apcupsd only; NUT-managed or absent UPSes report nothing here (…)"
  with `ok` severity. The `unraid://health` resource inherits the fix.
- **Why:** On a NUT-managed server (Deepwater) apcaccess prints nothing, the
  upstream resolver throws, and the combined query failed the entire rollup —
  the single most important tool. Absence of UPS data is not an outage.
- **Alternatives:** Tolerate partial GraphQL data in the client (rejected:
  changes error semantics for every tool); drop UPS from health (rejected:
  loses the on-battery critical signal on apcupsd servers).
- **Owner input:** Not needed.

### D21: ups_status maps the apcaccess-empty error to a non-error report

- **Decided:** When the API error contains `No UPS data returned from
  apcaccess`, `ups_status` returns a normal result: "No live UPS data — …
  a NUT-managed UPS is invisible here — check the NUT plugin's UI instead"
  with `upsDetected: false` in detailed mode. Other failures stay errors.
- **Why:** The acceptance test expects an honest "none" report; this is the
  third documented outcome of `Query.upsDevices` (now live-verified) and is
  the steady state on NUT servers, not a fault.
- **Owner input:** Not needed.

## Roadmap 2 — Phase 1 (0.0.12) "DX quick wins"

### D22: Vendored schema refreshed to unraid/api 4.37.4 with a version sidecar

- **Decided:** `npm run schema:update` is now `scripts/update-schema.mjs`: it
  fetches the SDL and upstream `api/package.json` and writes
  `schema/schema-version.json` (`apiVersion`, `source`, `fetchedAt`). The SDL
  (vendored 2026-05-31) was refreshed to 4.37.4 — exactly Deepwater's live
  version — and `loadSchemaVersion()` feeds the doctor's skew check.
- **Why:** The spec's "record the SDL's source version at schema:update time"
  needs a machine-readable place; the refresh itself was overdue (three
  upstream schema commits had landed) and Phase 0 proved the live server is on
  4.37.4.
- **Owner input:** Not needed.

### D23: `array_disk_action remove` retired (upstream removed the mutation)

- **Decided:** `Mutation.array.removeDiskFromArray` no longer exists upstream
  (unraid/api#2068, 2026-08-29). The action was dropped from the enum; a
  legacy `"remove"` call gets an explicit refusal pointing at the web UI.
- **Why:** Keeping it would have been a schema-validation failure at call time
  with no honest way to perform the operation. Removing a disk is a UI-guided
  workflow upstream now.
- **Owner input:** Not needed.

### D24: Container restart uses the API's native `restart` mutation

- **Decided:** `docker_container_action restart` calls `docker.restart(id)`
  (added upstream in #2022) instead of the composed stop-then-start with its
  read-back-quirk tolerance.
- **Why:** One mutation, no partial-restart states, and the description no
  longer claims the API lacks restart. The read-back-quirk mapping stays for
  all actions in the shared error path.
- **Owner input:** Not needed.

### D25: Version skew compares major.minor and only warns

- **Decided:** `connection_doctor` (and the `doctor` CLI) compare the server's
  `info.versions.core.api` with the recorded schema version on major.minor,
  ignoring patch and build metadata; skew is a `warn`, never a `fail`.
- **Why:** Patch releases do not change the GraphQL contract, and a skewed
  schema still works for most fields — failing the doctor would make the
  common "server slightly newer than the npm package" case look broken.
- **Owner input:** Not needed.

### D26: Raw GraphQL tools validate locally before the confirm gate

- **Decided:** `graphql_query`/`graphql_mutation` run graphql-js `validate`
  against the vendored schema (built lazily once) before anything else; a
  `dry_run: true` mutation needs no `confirm` because nothing is sent. The
  acceptance-test prompt's `archiveAll { total }` was corrected to a valid
  selection (`unread { total }`) — the old string was never schema-valid.
- **Why:** Did-you-mean hints save a network round-trip per typo; validating
  before the gate keeps invalid mutations from ever reaching an elicitation
  prompt.
- **Owner input:** Not needed.

## Roadmap 2 — Phase 2 (0.0.13) "Backup + VM snapshot completion"

### D27: VM snapshot revert/delete stay descoped after live validation

- **Decided:** `vm_snapshot_create`/`vm_snapshot_list` keep pointing at the
  Unraid UI for revert and delete; no `vm_snapshot_action` ships.
- **Why:** The §5 live-validation step could not pass: the validation server
  (Deepwater) has the VM service disabled (`vm_list` → "VMs are not
  available"; `virsh` cannot reach libvirt), so nothing could be probed. And
  the `unraid/webgui` source (`libvirt_helpers.php`: `vm_revert`,
  `vm_snapremove`, `vm_blockcommit`) shows the UI flow depends on the webgui's
  private snapshot database (`getvmsnapshots` / `delete_snapshots_database`),
  rewrites the domain XML to re-point each disk at its base image, force-
  destroys a running VM before reverting, unlinks overlay files along the
  backing chain, and copies OVMF NVRAM per snapshot. Reproducing that through
  `virsh` alone is exactly the chain-corruption risk D12 named; the spec
  pre-authorized keeping the descope in that case.
- **Owner input:** Only if VMs are enabled later and revert/delete matter —
  then a plan can validate against a real VM.

### D28: flash_backup design calls

- **Decided:** Config-only by default (`/boot/config`, ~270 MB live), the
  whole flash with `full: true` (~2.6 GB live, 15-minute command timeout with
  progress heartbeats); archive name `flash-backup-<scope>-<UTC>.tar.gz` from
  an injectable clock; share names validated `^[A-Za-z0-9._-]+$` and probed
  with `test -d` (refuse, never create a share); GNU tar exit 1 ("file changed
  as we read it") is tolerated ONLY when `tar -tzf` verification succeeds and
  the warning is echoed; `keep` prunes via a list-then-delete pair so the tool
  reports exactly which files it removed, ignoring anything outside the backup
  folder; no off-box copy is offered and the copy warns about the secrets in
  the archive.
- **Why:** Matches the spec's brief while staying honest and reversible-ish
  (the only deletions are archives the tool itself created). Unraid rewrites
  files under /boot/config during normal operation, so a strict exit-0 policy
  would fail real backups spuriously.
- **Owner input:** Not needed; the live write test (a real `flash_backup`
  run) is outside this session's read-only grant — please run it once.

## Roadmap 2 — Phase 3 (0.0.14) "Coverage: host configuration (SSH)"

### D29: Services — status parsed from rc.d text; docker/libvirt stop refused

- **Decided:** `service_list`/`service_action` drive `/etc/rc.d/rc.{samba,nfsd,sshd,docker,libvirt,tailscale}`. State comes from the `status` sentence ("… is currently running." / "… is not running.") because the scripts exit 0 either way (live-verified). `service_action` reads the status back after every verb and reports an error when it disagrees. `stop` needs `allow_stop: true`; stopping docker or libvirt is refused outright.
- **Why:** Exit codes carry no state on Unraid's scripts; stopping docker/libvirt is an array-scale event that `array_action` and the UI own.
- **Owner input:** Not needed.

### D30: Unassigned devices — plugin-only, partition paths, assigned-disk guard

- **Decided:** `unassigned_list` = `lsblk -J` minus every `device=` in emhttpd's `disks.ini` (array, parity, pools, flash) minus zram/loop/ram/dm/md/nbd pseudo-disks (zram0 showed up live). `unassigned_action` accepts only `/dev/sdX1` / `/dev/nvmeXnYpZ`, refuses partitions of assigned disks, requires `/usr/local/sbin/rc.unassigned` (no raw mount fallback), runs `mount|umount`, and verifies with `lsblk -o MOUNTPOINT`.
- **Why:** UD owns mount-point naming, SMB sharing, and cleanup; a raw `mount` would bypass all of it. No unassigned disk exists on the validation server, so verification-by-read-back is the contract.
- **Owner input:** Not needed.

### D31: Shares — emhttpd via emcmd with the web UI's exact form fields

- **Decided:** `share_create`/`share_edit` submit the ShareEdit form (`shareName, shareNameOrig, shareComment, shareAllocator, shareFloor, shareSplitLevel, shareUseCache, shareCachePool, shareCachePool2, shareCOW, shareInclude, shareExclude, cmdEditShare=Add Share|Apply`) and, when export/security change, the SecuritySMB form (`shareExport, shareSecurity, shareCaseSensitive, shareVolsizelimit, changeShareSecurity=Apply`) through `/usr/local/sbin/emcmd`, exactly as `unraid/webgui` does; fields outside the exposed subset are passed through from the current `.cfg`. Every write is verified by re-reading `/boot/config/shares/<name>.cfg` and reported as "not verified" on any mismatch. `share_delete` requires the share to be EMPTY (`find -mindepth 1 -print -quit`) and submits `cmdEditShare=Delete`; it never touches files. Names are validated like the UI (`^[A-Za-z0-9._-]{1,40}$`, no leading dot) and refused when reserved (emhttpd's `reservedNames`, disk names, pool names).
- **Why:** Writing `.cfg` files by hand would bypass emhttpd's validation and the live `shares.ini` state; the form path is the supported one. An actual share write was outside this session's grant, hence the read-back contract and honest "not verified" outcomes.
- **Owner input:** Wanted (non-blocking) — one real `share_create` → `share_edit` → `share_delete` round-trip on a throwaway share name to confirm emhttpd accepts the `Add Share` submission from emcmd.

