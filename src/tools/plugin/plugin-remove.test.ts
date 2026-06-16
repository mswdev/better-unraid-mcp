import { describe, expect, it } from "vitest";
import { PluginRemoveDocument, type PluginRemoveMutation } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createPluginRemoveHandler } from "./plugin-remove.js";

const restarted = { removePlugin: false } satisfies PluginRemoveMutation;

describe("plugin_remove gate + validation", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginRemoveHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect"],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-registry spec and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginRemoveHandler(executor)({
      response_format: "concise",
      names: ["/etc/passwd"],
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("plugin_remove dispatch + reporting", () => {
  it("sends names with bundled:false, restart:true and reports the restart", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginRemoveHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect"],
      confirm: true,
    });
    expect(calls[0]?.document).toBe(PluginRemoveDocument);
    expect(calls[0]?.variables).toEqual({
      input: { names: ["unraid-api-plugin-connect"], bundled: false, restart: true },
    });
    expect(firstText(result)).toMatch(
      /Remove of unraid-api-plugin-connect submitted; the Unraid API is restarting/,
    );
  });

  it("returns an error result when the client throws", async () => {
    const result = await createPluginRemoveHandler(throwingExecutor("boom"))({
      response_format: "concise",
      names: ["x"],
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to remove plugin\(s\) x: boom/);
  });
});
