import { quoteForShell } from "../_shared/quote-shell.js";

/** Friendly service names → the Slackware-style init script under /etc/rc.d. */
export const SERVICES = {
  samba: "rc.samba",
  nfs: "rc.nfsd",
  sshd: "rc.sshd",
  docker: "rc.docker",
  libvirt: "rc.libvirt",
  tailscale: "rc.tailscale",
} as const;

export type ServiceName = keyof typeof SERVICES;

export const SERVICE_NAMES = Object.keys(SERVICES) as ServiceName[];

export const RC_DIR = "/etc/rc.d";

/** rc.d verbs take a few seconds; docker/libvirt restarts can take longer. */
export const SERVICE_TIMEOUT_MS = 120_000;

export const PROBE_TIMEOUT_MS = 10_000;

/** Marker the list command prints for a script that is not present on the host. */
export const NOT_INSTALLED_MARKER = "NOT_INSTALLED";

export type ServiceState = "running" | "stopped" | "not_installed" | "unknown";

/**
 * Full path of a service's rc.d script.
 *
 * @param name - A friendly service name.
 * @returns e.g. `/etc/rc.d/rc.samba`.
 */
export function rcScript(name: ServiceName): string {
  return `${RC_DIR}/${SERVICES[name]}`;
}

/** The quoted script path followed by a verb, ready for the shell. */
export function rcCommand(name: ServiceName, verb: string): string {
  return `${quoteForShell(rcScript(name))} ${verb}`;
}

/**
 * Parses an rc.d `status` sentence. Unraid's scripts exit 0 whether or not
 * the daemon runs ("… is currently running." / "… is not running."), so the
 * state must come from the text.
 *
 * @param stdout - The first line of `rc.X status` output (or the not-installed marker).
 * @returns The parsed state; `unknown` when the sentence is unrecognised.
 */
export function parseStatusOutput(stdout: string): ServiceState {
  const line = stdout.trim();
  if (line === NOT_INSTALLED_MARKER) {
    return "not_installed";
  }
  if (/currently running/i.test(line)) {
    return "running";
  }
  if (/not running/i.test(line)) {
    return "stopped";
  }
  return "unknown";
}
