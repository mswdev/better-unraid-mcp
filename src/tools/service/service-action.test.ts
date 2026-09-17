import { describe, expect, it } from "vitest";
import type { ShellResult } from "../../shell/executor.js";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { createServiceActionHandler } from "./service-action.js";

const bothFlags = { confirm: true, acknowledge_risk: true } as const;
const ok = (stdout = ""): ShellResult => ({ stdout, stderr: "", exitCode: 0 });
const installed = ok();
const running = ok("Samba server daemon is currently running.\n");
const stopped = ok("Samba server daemon is not running.\n");

describe("service_action gates", () => {
  it("refuses without both flags and runs nothing", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({ service: "samba", action: "restart", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("requires allow_stop for stop", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({ service: "samba", action: "stop", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("allow_stop");
    expect(calls).toHaveLength(0);
  });

  it("refuses to stop docker or libvirt outright", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({
      service: "docker",
      action: "stop",
      allow_stop: true,
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("array_action");
    expect(calls).toHaveLength(0);
  });

  it("rejects an unknown service before any command", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({ service: "nginx" as never, action: "restart", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses when the service script is not installed", async () => {
    const { shell, calls } = sequencedShell([{ stdout: "", stderr: "", exitCode: 1 }]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({ service: "tailscale", action: "restart", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("not installed");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("test -x '/etc/rc.d/rc.tailscale'");
  });
});

describe("service_action execution", () => {
  it("restarts a service and verifies it is running afterwards", async () => {
    const { shell, calls } = sequencedShell([installed, ok("Restarting Samba\n"), running]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({ service: "samba", action: "restart", ...bothFlags });
    const text = firstText(result);

    expect(result.isError).toBeUndefined();
    expect(calls[1].command).toBe("'/etc/rc.d/rc.samba' restart");
    expect(calls[2].command).toBe("'/etc/rc.d/rc.samba' status");
    expect(text).toContain("verified");
    expect(text).toContain("running");
  });

  it("reports an unverified result when the read-back disagrees", async () => {
    const { shell } = sequencedShell([installed, ok(), stopped]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({ service: "samba", action: "start", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("not running");
  });

  it("stops a share service with allow_stop and verifies it stopped", async () => {
    const { shell, calls } = sequencedShell([installed, ok(), stopped]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({
      service: "nfs",
      action: "stop",
      allow_stop: true,
      ...bothFlags,
    });

    expect(result.isError).toBeUndefined();
    expect(calls[1].command).toBe("'/etc/rc.d/rc.nfsd' stop");
    expect(firstText(result)).toContain("stopped");
  });

  it("surfaces a failing rc.d verb", async () => {
    const { shell } = sequencedShell([installed, { stdout: "", stderr: "boom", exitCode: 1 }]);
    const handler = createServiceActionHandler(shell);

    const result = await handler({ service: "sshd", action: "restart", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("boom");
  });
});
