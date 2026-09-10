import { describe, expect, it } from "vitest";
import type { LogReadAllowlistQuery, LogReadContentQuery } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  sequencedExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createLogReadHandler, linesSchema, startLineSchema } from "./log-read.js";

const allowlist = {
  logFiles: [
    { name: "syslog", path: "/var/log/syslog" },
    { name: "docker.log", path: "/var/log/docker.log" },
  ],
} satisfies LogReadAllowlistQuery;

/** A tail of the last 2 lines of a 12-line file. */
const tail = {
  logFile: {
    path: "/var/log/syslog",
    content: "line eleven\nline twelve\n",
    totalLines: 12,
    startLine: 11,
  },
} satisfies LogReadContentQuery;

describe("log_read handler", () => {
  it("reads an allowlisted file by exact path and passes the canonical variables", async () => {
    const { executor, calls } = sequencedExecutor([allowlist, tail]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "/var/log/syslog",
      lines: 100,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.variables).toMatchObject({ path: "/var/log/syslog", lines: 100 });
    expect(firstText(result)).toMatch(/lines 11–12 of 12/);
    expect(firstText(result)).toMatch(/line eleven/);
  });

  it("resolves a bare name to the listed canonical path", async () => {
    const { executor, calls } = sequencedExecutor([allowlist, tail]);

    await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(calls[1]?.variables).toMatchObject({ path: "/var/log/syslog" });
  });

  it("refuses an unknown file without fetching content, listing valid names", async () => {
    const { executor, calls } = recordingExecutor(allowlist);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "/boot/config/super-secret",
      lines: 100,
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(firstText(result)).toMatch(/Unknown log file/);
    expect(firstText(result)).toMatch(/syslog, docker\.log/);
  });

  it("hints an earlier page in tail mode and no later page at EOF", async () => {
    const { executor } = sequencedExecutor([allowlist, tail]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 2,
    });

    expect(firstText(result)).toMatch(/earlier: re-call with start_line=9/);
    expect(firstText(result)).not.toMatch(/later:/);
  });

  it("hints both directions for a mid-file window", async () => {
    const window = {
      logFile: {
        path: "/var/log/syslog",
        content: "line five\nline six\n",
        totalLines: 12,
        startLine: 5,
      },
    } satisfies LogReadContentQuery;
    const { executor, calls } = sequencedExecutor([allowlist, window]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 2,
      start_line: 5,
    });

    expect(calls[1]?.variables).toMatchObject({
      path: "/var/log/syslog",
      lines: 2,
      startLine: 5,
    });
    expect(firstText(result)).toMatch(/lines 5–6 of 12/);
    expect(firstText(result)).toMatch(/earlier: re-call with start_line=3/);
    expect(firstText(result)).toMatch(/later: re-call with start_line=7/);
  });

  it("anchors the header at line 1 when the response omits startLine", async () => {
    const noStart = {
      logFile: {
        path: "/var/log/syslog",
        content: "line one\nline two\n",
        totalLines: 2,
        startLine: null,
      },
    } satisfies LogReadContentQuery;
    const { executor } = sequencedExecutor([allowlist, noStart]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(firstText(result)).toMatch(/lines 1–2 of 2/);
  });

  it("refuses with a placeholder when the allowlist itself is empty", async () => {
    const { executor, calls } = recordingExecutor({ logFiles: [] } satisfies LogReadAllowlistQuery);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    expect(firstText(result)).toMatch(/\(none listed\)/);
  });

  it("omits the earlier hint at the start of the file", async () => {
    const head = {
      logFile: {
        path: "/var/log/syslog",
        content: "line one\nline two\n",
        totalLines: 12,
        startLine: 1,
      },
    } satisfies LogReadContentQuery;
    const { executor } = sequencedExecutor([allowlist, head]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 2,
      start_line: 1,
    });

    expect(firstText(result)).not.toMatch(/earlier:/);
    expect(firstText(result)).toMatch(/later: re-call with start_line=3/);
  });

  it("explains a start_line past the end of the file", async () => {
    const past = {
      logFile: { path: "/var/log/syslog", content: "", totalLines: 12, startLine: 99 },
    } satisfies LogReadContentQuery;
    const { executor } = sequencedExecutor([allowlist, past]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
      start_line: 99,
    });

    expect(firstText(result)).toMatch(/no lines at or after start_line=99/);
    expect(firstText(result)).toMatch(/12 lines/);
  });

  it("reports an empty file", async () => {
    const empty = {
      logFile: { path: "/var/log/syslog", content: "", totalLines: 0, startLine: 1 },
    } satisfies LogReadContentQuery;
    const { executor } = sequencedExecutor([allowlist, empty]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(firstText(result)).toMatch(/is empty/);
  });

  it("surfaces a preflight failure", async () => {
    const result = await createLogReadHandler(throwingExecutor("listing broke"))({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to read log file syslog/);
    expect(firstText(result)).toMatch(/listing broke/);
  });

  it("surfaces a content-fetch failure after a clean preflight", async () => {
    const { executor } = sequencedExecutor([allowlist, new Error("read broke")]);

    const result = await createLogReadHandler(executor)({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/read broke/);
  });

  it("coerces a non-Error rejection to a string", async () => {
    const result = await createLogReadHandler(rejectingExecutor("plain refusal"))({
      response_format: "concise",
      path: "syslog",
      lines: 100,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/plain refusal/);
  });

  it("returns the raw payload for detailed", async () => {
    const { executor } = sequencedExecutor([allowlist, tail]);

    const result = await createLogReadHandler(executor)({
      response_format: "detailed",
      path: "syslog",
      lines: 100,
    });

    expect(JSON.parse(firstText(result))).toEqual(tail.logFile);
  });

  it("enforces the lines cap, default, and positivity via the schema", () => {
    expect(linesSchema.safeParse(undefined).success && linesSchema.parse(undefined)).toBe(100);
    expect(linesSchema.safeParse(2000).success).toBe(true);
    expect(linesSchema.safeParse(2001).success).toBe(false);
    expect(linesSchema.safeParse(0).success).toBe(false);
    expect(startLineSchema.safeParse(0).success).toBe(false);
    expect(startLineSchema.safeParse(1).success).toBe(true);
    expect(startLineSchema.safeParse(undefined).success).toBe(true);
  });
});
