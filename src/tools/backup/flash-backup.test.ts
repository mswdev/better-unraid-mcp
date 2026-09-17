import { describe, expect, it } from "vitest";
import type { ShellResult } from "../../shell/executor.js";
import { humanizeBytes } from "../_shared/format-bytes.js";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { archiveNameFor, createFlashBackupHandler } from "./flash-backup.js";

const fixedNow = new Date("2026-09-17T22:41:05Z");
const bothFlags = { confirm: true, acknowledge_risk: true } as const;
const EXPECTED_DIR = "/mnt/user/backups/flash-backups";
const EXPECTED_FILE = `${EXPECTED_DIR}/flash-backup-config-20260917-224105.tar.gz`;

const ok = (stdout = ""): ShellResult => ({ stdout, stderr: "", exitCode: 0 });
const probeOk = ok();
const tarOk = ok();
const verifyOk = ok("412\n283115520\n");

function handlerWith(results: Array<ShellResult | Error>) {
  const { shell, calls } = sequencedShell(results);
  const handler = createFlashBackupHandler({ shell, now: () => fixedNow });
  return { handler, calls };
}

describe("archiveNameFor", () => {
  it("names archives by scope and UTC timestamp", () => {
    expect(archiveNameFor("config", fixedNow)).toBe("flash-backup-config-20260917-224105.tar.gz");
    expect(archiveNameFor("full", fixedNow)).toBe("flash-backup-full-20260917-224105.tar.gz");
  });
});

describe("flash_backup gates and validation", () => {
  it("reports SSH unavailable when no shell is configured", async () => {
    const handler = createFlashBackupHandler({ shell: null });

    const result = await handler({ response_format: "concise", share: "backups", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("refuses without both flags and runs nothing", async () => {
    const { handler, calls } = handlerWith([]);

    const result = await handler({ response_format: "concise", share: "backups", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(firstText(result)).toContain("license key");
    expect(calls).toHaveLength(0);
  });

  it("rejects an unsafe share name before the gate", async () => {
    const { handler, calls } = handlerWith([]);

    const result = await handler({ response_format: "concise", share: "../etc", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("share");
    expect(calls).toHaveLength(0);
  });

  it("refuses when the share directory does not exist", async () => {
    const { handler, calls } = handlerWith([{ stdout: "", stderr: "", exitCode: 1 }]);

    const result = await handler({ response_format: "concise", share: "nope", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("share_list");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("test -d '/mnt/user/nope'");
  });
});

describe("flash_backup archiving", () => {
  it("archives /boot/config into the share and verifies it", async () => {
    const { handler, calls } = handlerWith([probeOk, tarOk, verifyOk]);

    const result = await handler({ response_format: "concise", share: "backups", ...bothFlags });
    const text = firstText(result);

    expect(result.isError).toBeUndefined();
    expect(calls[1].command).toBe(
      `mkdir -p '${EXPECTED_DIR}' && tar -czf '${EXPECTED_FILE}' -C '/boot' 'config'`,
    );
    expect(calls[2].command).toBe(
      `tar -tzf '${EXPECTED_FILE}' | wc -l && stat -c %s '${EXPECTED_FILE}'`,
    );
    expect(text).toContain(EXPECTED_FILE);
    expect(text).toContain("412 entries");
    expect(text).toContain(humanizeBytes(283115520));
    expect(text).toContain("license key");
    expect(calls).toHaveLength(3);
  });

  it("archives the whole flash with full: true", async () => {
    const { handler, calls } = handlerWith([probeOk, tarOk, verifyOk]);

    await handler({ response_format: "concise", share: "backups", full: true, ...bothFlags });

    expect(calls[1].command).toMatch(/flash-backup-full-20260917-224105\.tar\.gz' -C '\/boot' \.$/);
  });

  it("tolerates tar exit 1 (files changed while reading) when verification passes", async () => {
    const changed = {
      stdout: "",
      stderr: "tar: config/x: file changed as we read it",
      exitCode: 1,
    };
    const { handler } = handlerWith([probeOk, changed, verifyOk]);

    const result = await handler({ response_format: "concise", share: "backups", ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("file changed as we read it");
  });

  it("fails when tar fails hard", async () => {
    const failed = { stdout: "", stderr: "tar: /boot/config: Cannot open", exitCode: 2 };
    const { handler, calls } = handlerWith([probeOk, failed]);

    const result = await handler({ response_format: "concise", share: "backups", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Cannot open");
    expect(calls).toHaveLength(2);
  });

  it("fails when verification fails", async () => {
    const broken = { stdout: "", stderr: "gzip: unexpected end of file", exitCode: 1 };
    const { handler } = handlerWith([probeOk, tarOk, broken]);

    const result = await handler({ response_format: "concise", share: "backups", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("verification");
  });

  it("returns a structured payload in detailed mode", async () => {
    const { handler } = handlerWith([probeOk, tarOk, verifyOk]);

    const result = await handler({ response_format: "detailed", share: "backups", ...bothFlags });

    expect(JSON.parse(firstText(result))).toMatchObject({
      path: EXPECTED_FILE,
      scope: "config",
      entries: 412,
      bytes: 283115520,
      pruned: [],
    });
  });
});

describe("flash_backup pruning", () => {
  const older = [
    `${EXPECTED_DIR}/flash-backup-config-20260901-010101.tar.gz`,
    `${EXPECTED_DIR}/flash-backup-config-20260815-010101.tar.gz`,
  ];

  it("prunes archives beyond keep and reports exactly what it removed", async () => {
    const listing = ok(`${older.join("\n")}\n`);
    const { handler, calls } = handlerWith([probeOk, tarOk, verifyOk, listing, ok()]);

    const result = await handler({
      response_format: "concise",
      share: "backups",
      keep: 2,
      ...bothFlags,
    });

    expect(calls[3].command).toBe(`ls -1t '${EXPECTED_DIR}'/flash-backup-*.tar.gz | tail -n +3`);
    expect(calls[4].command).toBe(`rm -f '${older[0]}' '${older[1]}'`);
    expect(firstText(result)).toContain("Pruned 2 older archive(s)");
    expect(firstText(result)).toContain(older[1]);
  });

  it("removes nothing when the listing has nothing beyond keep", async () => {
    const { handler, calls } = handlerWith([probeOk, tarOk, verifyOk, ok("")]);

    const result = await handler({
      response_format: "concise",
      share: "backups",
      keep: 5,
      ...bothFlags,
    });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(4);
  });

  it("never prunes when keep is unset", async () => {
    const { handler, calls } = handlerWith([probeOk, tarOk, verifyOk]);

    await handler({ response_format: "concise", share: "backups", ...bothFlags });

    expect(calls).toHaveLength(3);
  });

  it("ignores listed paths outside the backup directory", async () => {
    const listing = ok("/etc/passwd\n");
    const { handler, calls } = handlerWith([probeOk, tarOk, verifyOk, listing]);

    const result = await handler({
      response_format: "concise",
      share: "backups",
      keep: 1,
      ...bothFlags,
    });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(4);
  });
});
