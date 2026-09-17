# Roadmap Acceptance Report — 2026-09-17 (better-unraid-mcp 0.0.10 vs Deepwater)

- **Server:** Deepwater — Unraid 7.3.2, API 4.37.4+ad268301, 27 data + 2 parity disks, 3 cache pools, 58 containers, Intel iGPU, NUT-managed UPS (`nut-dw.plg`), Unassigned Devices installed.
- **MCP server:** `better-unraid-mcp@0.0.10` (stdio; SSH configured; ADMIN key).
- **Who ran it:** the Roadmap 2 kickoff session itself (the kickoff prompt arrived without the report — decision D18). Only the read-only grant applied, so the whitelisted mutations (items 12–13) were SKIPPED.
- **How the gates were exercised:** Claude Code's auto-mode permission classifier blocked calling `array_action`, `system_power`, `graphql_mutation`, and `docker_container_action` without flags from the connected server (denial reason "Modify Shared Resources"). The refusal paths were therefore exercised from a local stdio client against an unreachable endpoint (`UNRAID_API_URL=http://127.0.0.1:9/graphql`, fake SSH host on port 9): every refusal fired before any network call, so the same code path is proven with zero risk. `apikey_manage` was allowed through and refused against the real server.

## Results

| # | Area | Result | Evidence |
|---|---|---|---|
| 1 | connection_doctor | PASS | `graphql ok (19 ms, Unraid 7.3.2, API 4.37.4)`, `ssh ok connected`, rate-limit line (90 burst / 9 per s), read-only line (disabled). |
| 2 | system_health | **FAIL** | `Failed to compute system health: Failed to get UPS data: No UPS data returned from apcaccess` — no OVERALL line at all. |
| 3 | array_action stop, no flags | PASS | `Refusing to stop the array … Re-call with "confirm": true and "acknowledge_risk": true … No changes were made.` |
| 4 | system_power reboot, no flags | PASS | `Refusing to reboot the server … "confirm": true and "acknowledge_risk": true … No changes were made.` (with SSH unconfigured it says so and refuses too). |
| 5 | docker_container_action stop, no confirm | PASS | `Refusing to stop container … requires confirmation … No changes were made.` |
| 6 | apikey_manage delete, no flags | PASS | Credential-management refusal naming both flags; `No changes were made.` (real server). |
| 7 | graphql_mutation archiveAll, no confirm | PASS | `Refusing to run a raw GraphQL mutation … "confirm": true … No changes were made.` |
| 8 | data_age_ms / snapshot cache | PASS | Back-to-back detailed calls: system_metrics 0 → 5 ms, array_status 0 → 1 ms, docker_container_list 0 → 2 ms. |
| 9 | structuredContent | PASS (3/4) | system_metrics, array_status, docker_container_list return `structuredContent`; system_health could not (item 2). |
| 10 | Read coverage | **FAIL** (2 of 8) | disk_list, share_list (6 shares), parity_history (5 entries), notification_overview (473 unread / 669 archived), notification_alerts (35), apikey_list (1 key, no values), plugin_list (1 api plugin, 25 .plg) all sensible. `ups_status` → error `Failed to fetch UPS status: Failed to get UPS data: No UPS data returned from apcaccess` instead of an honest none-report. `disk_list` `/dev/sda` lists partitions `sda1, sdaa1, sdab1, sdac1, sdad1, sdae1` (partitions of five other disks). |
| 11 | SSH reads | PASS | process_list top-5; gpu_metrics Intel detection + raw 3-sample dump (works, but ~3 000 chars of raw JSON — improvement queued); zfs_status/dataset/snapshot honest "none"; user_script_list 13 scripts; disk_smart_report /dev/sdb full smartctl report; docker_stats 58 containers `(source: ssh)`. |
| 12 | Notification round-trip | SKIPPED | Writes not pre-approved for this session (D18) — owner to re-run. |
| 13 | disk_spin down/up | SKIPPED | Same. |
| 14 | Resources | **FAIL** (1 of 4) | `unraid://schema` starts with the SDL banner; `unraid://doctor` JSON checks; `unraid://live/metrics` honest `{"waiting": true}` before subscribing; `unraid://health` throws `MCP error -32603: Failed to get UPS data …`. |
| 15 | Prompts | PASS | `triage-array-problem, find-resource-hog, safe-container-update, health-report`; the triage prompt names system_health, array_status, disk_list, notification_alerts, parity_history. |
| 16 | Subscriptions | PASS | Subscribed to `unraid://live/metrics` from a stdio client: 20 `resources/updated` notifications in 15 s; the read then returned a merged sample with `age_ms`; unsubscribe clean. |
| 17 | MCP_READ_ONLY | PASS | 33 tools listed, all read-only (no array_action, no shell_exec). |
| 18 | HTTP auth | PASS | No token: `Fatal: … MCP_TRANSPORT=http requires MCP_HTTP_BEARER_TOKEN …`, exit 1. With token: unauthenticated POST /mcp → 401, `Authorization: Bearer <token>` → 200. |

## FAIL details

### F1 — `system_health` (and `unraid://health`) fail outright when apcaccess has no data (items 2, 9, 14)
- Call: `system_health {}` / `resources/read unraid://health`.
- Got: `Failed to compute system health: Failed to get UPS data: No UPS data returned from apcaccess` (tool `isError`; resource → JSON-RPC -32603).
- Expected: an `OVERALL:` verdict with per-subsystem lines; the UPS subsystem reported as unavailable.
- Cause: the combined `SystemHealth` query selects `upsDevices`; on a NUT-managed server apcaccess prints nothing, the upstream resolver throws, the response carries `errors`, and `UnraidClient` rejects on any error.

### F2 — `ups_status` returns an error instead of an honest none-report (item 10)
- Call: `ups_status { response_format: "detailed" }`.
- Got: `Failed to fetch UPS status: Failed to get UPS data: No UPS data returned from apcaccess`.
- Expected: a non-error "no live UPS data" report that explains the Unraid API reads apcupsd only.

### F3 — `disk_list` partition prefix bleed (item 10)
- Call: `disk_list { response_format: "detailed" }`.
- Got: `/dev/sda` → partitions `sda1 (XFS 4 TB), sdaa1 (XFS 20 TB), sdab1, sdac1, sdad1, sdae1 (VFAT 62 GB — the flash drive)`.
- Expected: only `sda1`.
- Cause: the Unraid API matches partitions to disks by device-name prefix, so `sda` collects every `sdaX` device on servers with more than 26 disks.

## Improvements queued from PASS items
- `gpu_metrics` Intel path: summarize the `intel_gpu_top -J` sample (frequency, rc6, engine busy, clients) instead of dumping the raw unterminated JSON array.

## Configuration notes for the owner
- Items 12–13 need one owner-run pass (or a kickoff grant that whitelists those two reversible writes).
- Claude Code's auto-mode classifier blocks no-flag calls to the tier-2 tools; to test refusals from Claude Code itself, run the acceptance prompt in a session with the default permission mode and approve the calls.
