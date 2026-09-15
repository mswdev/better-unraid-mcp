# Roadmap Acceptance Test — 0.0.4 → 0.0.9

Paste the prompt below into a **fresh session** of an MCP client (Claude Code or
Claude Desktop recommended — stdio unlocks elicitation and subscriptions) with
`better-unraid-mcp@0.0.9` connected to a **real Unraid server**. Use an ADMIN
API key and configured SSH for full coverage; the prompt handles their absence
gracefully. It exercises every capability the 0.0.4–0.0.9 roadmap shipped and
produces a structured pass/fail report you can hand straight back to a
development session to implement fixes.

---

## The prompt

```text
You are acceptance-testing the better-unraid-mcp MCP server (expected version
0.0.9) against my real Unraid server. Work through the checklist below in
order. For each numbered item record: PASS / FAIL / SKIPPED (with the reason —
e.g. "SSH not configured", "client lacks elicitation"), plus a one-line note
quoting the decisive evidence. NEVER perform a destructive action beyond the
explicitly whitelisted safe targets. When a gated tool is being tested for its
REFUSAL, call it WITHOUT confirm/acknowledge_risk and expect a refusal that
names the flags and states "No changes were made."

SETUP
1. Call connection_doctor. Expect: GraphQL reachable with latency and Unraid/
   API versions, SSH status reported (connected / not configured), rate-limit
   config line, read-only mode line.
2. Call system_health. Expect: "OVERALL:" verdict plus per-subsystem lines
   (array, capacity, disks, parity, notifications, ups, docker).

SAFETY GATES (no changes may result from any of these)
3. Call array_action with action "stop" and NO flags. Expect a tier-2 refusal
   (both confirm and acknowledge_risk named) — or, if this client supports
   elicitation, an interactive prompt: DECLINE it and expect "declined ... No
   changes were made."
4. Call system_power with action "reboot" and NO flags. Expect the same
   two-flag refusal or a declined prompt. The server must NOT reboot.
5. Call docker_container_action (action "stop", any real container id) with NO
   confirm. Expect a tier-1 refusal and zero effect.
6. Call apikey_manage action "delete" with ids ["nonexistent"] and NO flags.
   Expect the credential-management refusal before any API call.
7. Call graphql_mutation with mutation "mutation { archiveAll { total } }" and
   NO confirm. Expect the confirmation refusal.

READ COVERAGE
8. system_metrics, array_status, docker_container_list — each must succeed AND
   include data_age_ms in detailed output; call one of them twice quickly and
   confirm the second response's data_age_ms > 0 (snapshot cache serving).
9. system_metrics / array_status / docker_container_list / system_health must
   each return structuredContent alongside the text (your client shows this as
   structured output; if it hides it, mark SKIPPED with reason).
10. disk_list, share_list, parity_history, notification_overview,
    notification_alerts, ups_status, apikey_list (must NOT contain any key
    values), plugin_list — each returns sensible data or an honest "none"
    report.
11. SSH reads (SKIP all with reason if SSH is unconfigured): process_list,
    gpu_metrics (absence report counts as PASS if no GPU tooling),
    zfs_status / zfs_dataset_list / zfs_snapshot_list (absence report counts
    as PASS if no ZFS), user_script_list (absence report OK),
    disk_smart_report on one /dev/sdX from disk_list, docker_stats (note
    which source served it: ssh or live subscription).

SAFE MUTATIONS (whitelisted, reversible)
12. notification_create a TEST notification ("acceptance-test", importance
    INFO), then notification_list unread to find its id, notification_archive
    it, notification_unread it, archive it again, and notification_delete it
    (confirm: true). Each step verified by a follow-up read.
13. If SSH is configured and a spinning array disk exists: disk_spin down one
    DATA disk (confirm: true), verify with disk_list, then disk_spin it up.
    Otherwise SKIPPED.

MODERN MCP SURFACE
14. Read resources unraid://schema (starts with GraphQL SDL), unraid://health
    (JSON verdict), unraid://doctor (JSON checks). If your client cannot read
    resources, SKIPPED with reason.
15. List prompts. Expect triage-array-problem, find-resource-hog,
    safe-container-update, health-report. Fetch one and confirm it names the
    tools it orchestrates.
16. If the client supports resource subscriptions: subscribe to
    unraid://live/metrics, wait ~15 s, and confirm at least one
    resources/updated notification arrived and the resource read now returns
    a sample with age_ms instead of {"waiting": true}. Then unsubscribe.
    Otherwise read unraid://live/metrics once and expect the honest
    {"waiting": true} envelope (that is a PASS for graceful degradation).

CONFIGURATION MODES (report as MANUAL if you cannot restart the server)
17. Restart the server with MCP_READ_ONLY=true and list tools: expect ~33
    read-only tools, zero mutating ones (no array_action, no shell_exec).
18. Start the server with MCP_TRANSPORT=http and NO bearer token: expect it to
    REFUSE to start, naming MCP_HTTP_BEARER_TOKEN. With a token set, expect a
    401 on an unauthenticated curl POST to /mcp and success with
    "Authorization: Bearer <token>".

REPORT
Finish with a table: item number, area, PASS/FAIL/SKIPPED, evidence note.
Below the table list every FAIL with: the exact tool call made, the full error
or wrong output received, and what the expected behavior was — precise enough
for a developer to reproduce and fix without asking questions.
```

---

## Notes for the owner

- Items 17–18 need shell access to restart the server; everything else runs
  from inside the MCP session.
- Elicitation-dependent expectations (items 3–4) apply on stdio or
  session-mode HTTP (`MCP_HTTP_SESSIONS=true`); on stateless HTTP the
  argument-refusal path is the correct behavior.
- Live-subscription expectations (item 16, docker_stats live source in 11)
  require the client to issue `resources/subscribe`; Claude clients currently
  vary — the graceful-degradation branch is the expected result there.
