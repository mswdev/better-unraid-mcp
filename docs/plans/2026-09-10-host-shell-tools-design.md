# Host shell tools design (PR: host diagnostics)

## Problem

The GraphQL API cannot serve several diagnostics that matter for real incident
investigation on an Unraid box:

- Files outside `/var/log`: the `logFiles` allowlist is confined to the log
  directory, so `/boot/logs/syslog-previous` (previous-boot oops traces),
  `/proc/cpuinfo` (microcode), and similar are unreachable.
- Per-container resource usage: `DockerContainerStats` exists in the SDL but
  only as a Subscription; there is no Query equivalent, and this server has no
  subscription transport.
- Arbitrary one-off commands (`dmesg`, `df /boot`).

## Decision: optional SSH domain

Add a second executor seam, `ShellExecutor` (`src/shell/executor.ts`),
implemented over SSH (ssh2, fresh connection per call, stateless like the
GraphQL client). It is opt-in: constructed only when `UNRAID_SSH_HOST` is set
(plus `UNRAID_SSH_PASSWORD` or `UNRAID_SSH_KEY_PATH`; port defaults 22, user
defaults root). When unconfigured, the host tools register but refuse with
setup guidance, keeping tools/list stable.

## Tools

- `file_read` (read-only, ungated): `tail -n N -- <path>`, optional
  extended-regex `pattern` via `grep | tail` under `set -o pipefail` so grep
  failures are not masked by tail's exit 0 and grep's no-match exit 1 is
  distinguishable. Absolute paths only; inputs pass through single-quote shell
  escaping (`quoteForShell`).
- `shell_exec` (destructive, confirm-gated): arbitrary command as the SSH
  user. Non-zero exits are results, not errors (grep semantics). Timeout
  default 30s, max 120s.
- `docker_stats` (read-only, ungated): fixed command
  `docker stats --no-stream --format '{{json .}}'` (no interpolated input, so
  no injection surface), parsed and sorted hungriest CPU first.

## Also in this change: mover_status (GraphQL, not SSH)

`Query.vars` exposes `shareMoverActive`, `shareMoverSchedule`,
`shareMoverLogging`, so mover state ships as a plain GraphQL read.

## Safety and efficiency

- `shell_exec` is the only ungated-input command path and requires
  `confirm: true` on every call; the two ungated SSH tools are strictly
  read-only (fixed command, or tail/grep with quoted inputs).
- All command output is capped at 30k characters (tail kept, drop noted) so
  one call cannot flood the client's context.
- Timeouts on connect and exec; credentials come only from env and are never
  logged or echoed in tool output.

## Deferred

- GraphQL subscriptions transport (graphql-ws): polling plus SSH covers the
  diagnostic need; revisit if live monitoring becomes a real use case.
- Flash health tool: `df /boot` via file_read/shell_exec suffices.
- rclone and the `.plg` installer: unchanged from earlier deferrals
  (non-functional upstream in production builds; arbitrary-URL installer with
  a restart-volatile async op model).

## Live-verification gap (standing)

Like every prior domain, these tools are hermetically tested and not yet
exercised against a live Unraid box. First live checks: file_read against
/boot/logs, docker_stats output parsing against the box's docker version,
and an intentional shell_exec timeout.
