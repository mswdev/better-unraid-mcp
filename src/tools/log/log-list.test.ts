import { describe, expect, it } from "vitest";
import type { LogListQuery } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createLogListHandler } from "./log-list.js";

const data = {
  logFiles: [
    {
      name: "docker.log",
      path: "/var/log/docker.log",
      size: 2048,
      modifiedAt: "2026-06-05T08:00:00.000Z",
    },
    {
      name: "syslog",
      path: "/var/log/syslog",
      size: 1258291,
      modifiedAt: "2026-06-06T11:58:00.000Z",
    },
  ],
} satisfies LogListQuery;

describe("log_list handler", () => {
  it("lists files most recently modified first with humanized sizes", async () => {
    const { executor } = recordingExecutor(data);

    const result = await createLogListHandler(executor)({ response_format: "concise" });

    const text = firstText(result);
    expect(text.indexOf("syslog")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("syslog")).toBeLessThan(text.indexOf("docker.log"));
    expect(text).toMatch(/1\.2 MB/);
    expect(text).toMatch(/2\.0 KB/);
  });

  it("reports an honestly-ambiguous empty list", async () => {
    const { executor } = recordingExecutor({ logFiles: [] } satisfies LogListQuery);

    const result = await createLogListHandler(executor)({ response_format: "concise" });

    expect(firstText(result)).toMatch(/No log files listed/);
    expect(firstText(result)).toMatch(/unreadable/);
  });

  it("returns the full sorted array for detailed", async () => {
    const { executor } = recordingExecutor(data);

    const result = await createLogListHandler(executor)({ response_format: "detailed" });

    const payload = JSON.parse(firstText(result)) as LogListQuery["logFiles"];
    expect(payload).toHaveLength(2);
    expect(payload[0]?.name).toBe("syslog");
  });

  it("returns an error result when the client throws", async () => {
    const result = await createLogListHandler(throwingExecutor("boom"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to list log files/);
    expect(firstText(result)).toMatch(/boom/);
  });

  it("coerces a non-Error rejection to a string", async () => {
    const result = await createLogListHandler(rejectingExecutor("plain refusal"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/plain refusal/);
  });
});
