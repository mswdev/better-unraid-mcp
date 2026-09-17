import { describe, expect, it } from "vitest";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { parseStatusOutput, rcScript } from "./_shared.js";
import { createServiceListHandler } from "./service-list.js";

const LISTING = [
  "rc.samba: Samba server daemon is currently running.",
  "rc.nfsd: NFS server daemon is not running.",
  "rc.sshd: SSH server daemon is currently running.",
  "rc.docker: Docker daemon is currently running.",
  "rc.libvirt: libvirt daemon is not running.",
  "rc.tailscale: NOT_INSTALLED",
  "",
].join("\n");

describe("service _shared", () => {
  it("maps friendly names to rc.d scripts", () => {
    expect(rcScript("nfs")).toBe("/etc/rc.d/rc.nfsd");
    expect(rcScript("samba")).toBe("/etc/rc.d/rc.samba");
  });

  it("parses the rc.d status sentence (scripts exit 0 either way)", () => {
    expect(parseStatusOutput("Samba server daemon is currently running.")).toBe("running");
    expect(parseStatusOutput("NFS server daemon is not running.")).toBe("stopped");
    expect(parseStatusOutput("NOT_INSTALLED")).toBe("not_installed");
    expect(parseStatusOutput("something odd")).toBe("unknown");
  });
});

describe("service_list", () => {
  it("reports every standard service with its parsed state", async () => {
    const { shell, calls } = sequencedShell([{ stdout: LISTING, stderr: "", exitCode: 0 }]);
    const handler = createServiceListHandler(shell);

    const result = await handler({ response_format: "concise" });
    const text = firstText(result);

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toContain("'/etc/rc.d/rc.samba' status");
    expect(text).toContain("samba: running");
    expect(text).toContain("nfs: stopped");
    expect(text).toContain("tailscale: not installed");
  });

  it("returns structured services in detailed mode", async () => {
    const { shell } = sequencedShell([{ stdout: LISTING, stderr: "", exitCode: 0 }]);
    const handler = createServiceListHandler(shell);

    const result = await handler({ response_format: "detailed" });
    const parsed = JSON.parse(firstText(result)) as {
      services: Array<{ name: string; state: string }>;
    };

    expect(parsed.services.find((s) => s.name === "docker")).toMatchObject({ state: "running" });
    expect(parsed.services).toHaveLength(6);
  });

  it("reports SSH unavailable without a shell", async () => {
    const result = await createServiceListHandler(null)({ response_format: "concise" });

    expect(result.isError).toBe(true);
  });
});
