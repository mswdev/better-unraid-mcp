import { describe, expect, it } from "vitest";
import type { ShellResult } from "../../shell/executor.js";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { createShareCreateHandler } from "./share-create.js";

const bothFlags = { confirm: true, acknowledge_risk: true } as const;
const ok = (stdout = ""): ShellResult => ({ stdout, stderr: "", exitCode: 0 });
const missing: ShellResult = { stdout: "", stderr: "cat: no such file", exitCode: 1 };
const context = ok(
  '["cache"]\ntype="Cache"\n["disk1"]\ntype="Data"\n=== VAR\nreservedNames="flash,boot"\n',
);
const CFG_AFTER =
  'shareComment="Films"\nshareAllocator="highwater"\nshareUseCache="yes"\nshareCachePool="cache"\nshareExport="e"\nshareSecurity="public"\n';

describe("share_create gates", () => {
  it("refuses without both flags and runs nothing", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createShareCreateHandler(shell);

    const result = await handler({ name: "media", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("rejects invalid names before the gate", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createShareCreateHandler(shell);

    const result = await handler({ name: "bad name", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses when the share already exists", async () => {
    const { shell, calls } = sequencedShell([ok('shareComment=""\n')]);
    const handler = createShareCreateHandler(shell);

    const result = await handler({ name: "media", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("share_edit");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("cat '/boot/config/shares/media.cfg'");
  });

  it("refuses reserved, pool, and disk names before touching emhttpd", async () => {
    for (const name of ["flash", "cache", "disk1"]) {
      const { shell, calls } = sequencedShell([missing, context]);
      const handler = createShareCreateHandler(shell);

      const result = await handler({ name, ...bothFlags });

      expect(result.isError).toBe(true);
      expect(firstText(result)).toContain("reserved");
      expect(calls).toHaveLength(2);
    }
  });

  it("refuses an unknown cache pool", async () => {
    const { shell, calls } = sequencedShell([missing, context]);
    const handler = createShareCreateHandler(shell);

    const result = await handler({ name: "media", cachePool: "nvme", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("cache_downloads".slice(0, 5));
    expect(calls).toHaveLength(2);
  });
});

describe("share_create execution", () => {
  it("creates the share via emcmd, applies SMB settings, and verifies the cfg", async () => {
    const { shell, calls } = sequencedShell([missing, context, ok(), ok(), ok(CFG_AFTER)]);
    const handler = createShareCreateHandler(shell);

    const result = await handler({
      name: "media",
      comment: "Films",
      useCache: "yes",
      cachePool: "cache",
      smbExport: "e",
      ...bothFlags,
    });
    const text = firstText(result);

    expect(result.isError).toBeUndefined();
    expect(calls[2].command).toBe(
      "'/usr/local/sbin/emcmd' 'shareName=media&shareNameOrig=&shareComment=Films&shareAllocator=highwater&shareFloor=&shareSplitLevel=&shareUseCache=yes&shareCachePool=cache&shareCachePool2=&shareCOW=auto&shareInclude=&shareExclude=&cmdEditShare=Add%20Share'",
    );
    expect(calls[3].command).toBe(
      "'/usr/local/sbin/emcmd' 'shareName=media&shareExport=e&shareSecurity=public&shareCaseSensitive=auto&shareVolsizelimit=&changeShareSecurity=Apply'",
    );
    expect(calls[4].command).toBe("cat '/boot/config/shares/media.cfg'");
    expect(text).toContain("verified");
    expect(calls).toHaveLength(5);
  });

  it("skips the SMB call when no SMB field was given", async () => {
    const { shell, calls } = sequencedShell([
      missing,
      context,
      ok(),
      ok('shareComment=""\nshareUseCache="no"\n'),
    ]);
    const handler = createShareCreateHandler(shell);

    const result = await handler({ name: "media", ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(4);
  });

  it("surfaces emhttpd's error text and verifies nothing", async () => {
    const { shell, calls } = sequencedShell([
      missing,
      context,
      { stdout: "Share name in use\n", stderr: "", exitCode: 1 },
    ]);
    const handler = createShareCreateHandler(shell);

    const result = await handler({ name: "media", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Share name in use");
    expect(calls).toHaveLength(3);
  });

  it("reports an unverified create when the cfg read-back differs", async () => {
    const { shell } = sequencedShell([
      missing,
      context,
      ok(),
      ok('shareComment="Films"\nshareUseCache="no"\n'),
    ]);
    const handler = createShareCreateHandler(shell);

    const result = await handler({
      name: "media",
      comment: "Films",
      useCache: "yes",
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("shareUseCache");
    expect(firstText(result)).toContain("not verified");
  });
});
