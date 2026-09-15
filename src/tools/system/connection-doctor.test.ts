import { describe, expect, it } from "vitest";
import type { ConnectionDoctorQuery } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  recordingShell,
  throwingExecutor,
  throwingShell,
} from "../_shared/test-support.js";
import { createConnectionDoctorHandler } from "./connection-doctor.js";

const doctorFixture = {
  online: true,
  info: { versions: { core: { unraid: "7.0.1", api: "4.35.0" } } },
} satisfies ConnectionDoctorQuery;

const okShellResult = { stdout: "ok\n", stderr: "", exitCode: 0 };

describe("connection_doctor", () => {
  it("reports a healthy GraphQL connection with version and latency", async () => {
    const { executor } = recordingExecutor(doctorFixture);
    const handler = createConnectionDoctorHandler({
      client: executor,
      shell: null,
      readOnly: false,
    });

    const result = await handler({ response_format: "concise" });
    const text = firstText(result);

    expect(text).toContain("Unraid 7.0.1");
    expect(text).toMatch(/\d+ ?ms/);
  });

  it("classifies an auth failure as an API key problem", async () => {
    const handler = createConnectionDoctorHandler({
      client: throwingExecutor("Unraid API HTTP 401 Unauthorized"),
      shell: null,
      readOnly: false,
    });

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("API key");
  });

  it("classifies a network failure as unreachable", async () => {
    const handler = createConnectionDoctorHandler({
      client: throwingExecutor("fetch failed: ECONNREFUSED"),
      shell: null,
      readOnly: false,
    });

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("unreachable");
  });

  it("reports SSH as optional when not configured", async () => {
    const { executor } = recordingExecutor(doctorFixture);
    const handler = createConnectionDoctorHandler({
      client: executor,
      shell: null,
      readOnly: false,
    });

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("SSH: not configured");
  });

  it("probes SSH when configured", async () => {
    const { executor } = recordingExecutor(doctorFixture);
    const { shell, calls } = recordingShell(okShellResult);
    const handler = createConnectionDoctorHandler({ client: executor, shell, readOnly: false });

    const result = await handler({ response_format: "concise" });

    expect(calls[0].command).toBe("echo ok");
    expect(firstText(result)).toContain("SSH: connected");
  });

  it("reports an SSH failure without failing the whole doctor", async () => {
    const { executor } = recordingExecutor(doctorFixture);
    const handler = createConnectionDoctorHandler({
      client: executor,
      shell: throwingShell("auth failed"),
      readOnly: false,
    });

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("SSH: failed");
  });

  it("reports read-only mode", async () => {
    const { executor } = recordingExecutor(doctorFixture);
    const handler = createConnectionDoctorHandler({
      client: executor,
      shell: null,
      readOnly: true,
    });

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("read-only mode: enabled");
  });

  it("returns structured checks in detailed mode", async () => {
    const { executor } = recordingExecutor(doctorFixture);
    const handler = createConnectionDoctorHandler({
      client: executor,
      shell: null,
      readOnly: false,
    });

    const result = await handler({ response_format: "detailed" });
    const parsed = JSON.parse(firstText(result)) as { checks: Array<{ check: string }> };

    expect(parsed.checks.length).toBeGreaterThanOrEqual(4);
  });
});
