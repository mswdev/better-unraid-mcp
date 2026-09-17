import { describe, expect, it } from "vitest";
import type { ConnectionDoctorQuery } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  recordingShell,
  throwingExecutor,
  throwingShell,
} from "../_shared/test-support.js";
import { compareApiVersions, createConnectionDoctorHandler } from "./connection-doctor.js";

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
      schemaApiVersion: null,
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
      schemaApiVersion: null,
    });

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("API key");
  });

  it("classifies a network failure as unreachable", async () => {
    const handler = createConnectionDoctorHandler({
      client: throwingExecutor("fetch failed: ECONNREFUSED"),
      shell: null,
      readOnly: false,
      schemaApiVersion: null,
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
      schemaApiVersion: null,
    });

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("SSH: not configured");
  });

  it("probes SSH when configured", async () => {
    const { executor } = recordingExecutor(doctorFixture);
    const { shell, calls } = recordingShell(okShellResult);
    const handler = createConnectionDoctorHandler({
      client: executor,
      shell,
      readOnly: false,
      schemaApiVersion: null,
    });

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
      schemaApiVersion: null,
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
      schemaApiVersion: null,
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
      schemaApiVersion: null,
    });

    const result = await handler({ response_format: "detailed" });
    const parsed = JSON.parse(firstText(result)) as { checks: Array<{ check: string }> };

    expect(parsed.checks.length).toBeGreaterThanOrEqual(4);
  });
});

describe("compareApiVersions", () => {
  it("is ok when major.minor match (patch and build metadata ignored)", () => {
    const check = compareApiVersions("4.37.4+ad268301", "4.37.1");

    expect(check).toMatchObject({ check: "schema", status: "ok" });
    expect(check.detail).toContain("4.37.1");
  });

  it("warns naming both versions on a minor mismatch", () => {
    const check = compareApiVersions("4.39.0", "4.37.4");

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("4.39.0");
    expect(check.detail).toContain("4.37.4");
  });

  it("warns when the schema version is unrecorded", () => {
    expect(compareApiVersions("4.37.4", null).status).toBe("warn");
  });

  it("warns when the server did not report a version", () => {
    expect(compareApiVersions(null, "4.37.4").status).toBe("warn");
  });
});

describe("connection_doctor schema check", () => {
  it("emits a schema check right after the graphql check", async () => {
    const { executor } = recordingExecutor(doctorFixture);
    const handler = createConnectionDoctorHandler({
      client: executor,
      shell: null,
      readOnly: false,
      schemaApiVersion: "4.35.9",
    });

    const result = await handler({ response_format: "detailed" });
    const parsed = JSON.parse(firstText(result)) as {
      checks: Array<{ check: string; status: string }>;
    };

    expect(parsed.checks[1]).toMatchObject({ check: "schema", status: "ok" });
  });

  it("skips the comparison (warn) when the graphql check failed", async () => {
    const handler = createConnectionDoctorHandler({
      client: throwingExecutor("fetch failed: ECONNREFUSED"),
      shell: null,
      readOnly: false,
      schemaApiVersion: "4.37.4",
    });

    const result = await handler({ response_format: "detailed" });
    const parsed = JSON.parse(firstText(result)) as {
      checks: Array<{ check: string; status: string }>;
    };

    expect(parsed.checks[1]).toMatchObject({ check: "schema", status: "warn" });
  });
});
