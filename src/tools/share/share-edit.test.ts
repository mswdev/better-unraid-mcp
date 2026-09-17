import { describe, expect, it } from "vitest";
import type { ShellResult } from "../../shell/executor.js";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { createShareEditHandler } from "./share-edit.js";

const bothFlags = { confirm: true, acknowledge_risk: true } as const;
const ok = (stdout = ""): ShellResult => ({ stdout, stderr: "", exitCode: 0 });
const missing: ShellResult = { stdout: "", stderr: "cat: no such file", exitCode: 1 };
const context = ok('["cache"]\ntype="Cache"\n=== VAR\nreservedNames="flash"\n');
const CFG_BEFORE =
  'shareComment="Old"\nshareAllocator="highwater"\nshareFloor="100"\nshareUseCache="no"\nshareCachePool=""\nshareExport="-"\nshareSecurity="public"\nshareCaseSensitive="auto"\n';
const CFG_AFTER =
  'shareComment="New"\nshareAllocator="mostfree"\nshareFloor="100"\nshareUseCache="no"\nshareCachePool=""\nshareExport="-"\nshareSecurity="public"\n';

describe("share_edit", () => {
  it("refuses without both flags and runs nothing", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createShareEditHandler(shell);

    const result = await handler({ name: "media", comment: "x" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("requires at least one setting to change", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createShareEditHandler(shell);

    const result = await handler({ name: "media", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("nothing to change");
    expect(calls).toHaveLength(0);
  });

  it("refuses when the share does not exist", async () => {
    const { shell, calls } = sequencedShell([missing]);
    const handler = createShareEditHandler(shell);

    const result = await handler({ name: "ghost", comment: "x", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("share_create");
    expect(calls).toHaveLength(1);
  });

  it("applies changes on top of the current cfg and verifies them", async () => {
    const { shell, calls } = sequencedShell([ok(CFG_BEFORE), context, ok(), ok(CFG_AFTER)]);
    const handler = createShareEditHandler(shell);

    const result = await handler({
      name: "media",
      comment: "New",
      allocator: "mostfree",
      ...bothFlags,
    });

    expect(result.isError).toBeUndefined();
    expect(calls[2].command).toContain(
      "shareNameOrig=media&shareComment=New&shareAllocator=mostfree&shareFloor=100",
    );
    expect(calls[2].command).toMatch(/cmdEditShare=Apply'$/);
    expect(firstText(result)).toContain("verified");
    expect(calls).toHaveLength(4);
  });

  it("sends the SMB form when export or security change", async () => {
    const after = ok(CFG_BEFORE.replace('shareExport="-"', 'shareExport="eh"'));
    const { shell, calls } = sequencedShell([ok(CFG_BEFORE), context, ok(), ok(), after]);
    const handler = createShareEditHandler(shell);

    const result = await handler({ name: "media", smbExport: "eh", ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(calls[3].command).toContain("shareExport=eh&shareSecurity=public");
    expect(calls).toHaveLength(5);
  });

  it("refuses a cache pool that is not in disks.ini", async () => {
    const { shell, calls } = sequencedShell([ok(CFG_BEFORE), context]);
    const handler = createShareEditHandler(shell);

    const result = await handler({ name: "media", cachePool: "nvme", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("reports an unverified edit when the read-back still shows the old value", async () => {
    const { shell } = sequencedShell([ok(CFG_BEFORE), context, ok(), ok(CFG_BEFORE)]);
    const handler = createShareEditHandler(shell);

    const result = await handler({ name: "media", comment: "New", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("not verified");
  });
});
