import { describe, expect, it } from "vitest";
import type { ShellResult } from "../../shell/executor.js";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { createShareDeleteHandler } from "./share-delete.js";

const bothFlags = { confirm: true, acknowledge_risk: true } as const;
const ok = (stdout = ""): ShellResult => ({ stdout, stderr: "", exitCode: 0 });
const missing: ShellResult = { stdout: "", stderr: "cat: no such file", exitCode: 1 };
const existing = ok('shareComment="x"\n');

describe("share_delete", () => {
  it("refuses without both flags and runs nothing", async () => {
    const { shell, calls } = sequencedShell([]);
    const handler = createShareDeleteHandler(shell);

    const result = await handler({ name: "media", confirm: true });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses when the share config does not exist", async () => {
    const { shell, calls } = sequencedShell([missing]);
    const handler = createShareDeleteHandler(shell);

    const result = await handler({ name: "ghost", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("refuses to delete a share that still contains data and says where it lives", async () => {
    const { shell, calls } = sequencedShell([existing, ok("/mnt/user/media/Films\n")]);
    const handler = createShareDeleteHandler(shell);

    const result = await handler({ name: "media", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("/mnt/user/media");
    expect(firstText(result)).toContain("only removes the share configuration");
    expect(calls[1].command).toBe("find '/mnt/user/media' -mindepth 1 -print -quit 2>/dev/null");
    expect(calls).toHaveLength(2);
  });

  it("deletes an empty share's config through emhttpd and verifies the cfg is gone", async () => {
    const { shell, calls } = sequencedShell([existing, ok(""), ok(), missing]);
    const handler = createShareDeleteHandler(shell);

    const result = await handler({ name: "media", ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(calls[2].command).toBe(
      "'/usr/local/sbin/emcmd' 'shareName=media&shareNameOrig=media&cmdEditShare=Delete'",
    );
    expect(firstText(result)).toContain("verified");
    expect(calls).toHaveLength(4);
  });

  it("reports an unverified delete when the cfg still exists", async () => {
    const { shell } = sequencedShell([existing, ok(""), ok(), existing]);
    const handler = createShareDeleteHandler(shell);

    const result = await handler({ name: "media", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("still exists");
  });

  it("surfaces emhttpd errors", async () => {
    const { shell } = sequencedShell([
      existing,
      ok(""),
      { stdout: "Bad share\n", stderr: "", exitCode: 1 },
    ]);
    const handler = createShareDeleteHandler(shell);

    const result = await handler({ name: "media", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Bad share");
  });
});
