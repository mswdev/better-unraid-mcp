import { describe, expect, it } from "vitest";
import { PluginAddDocument, type PluginAddMutation } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createPluginAddHandler } from "./plugin-add.js";

const restarted = { addPlugin: false } satisfies PluginAddMutation;

describe("plugin_add gate + validation", () => {
  it("refuses without confirm and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginAddHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect"],
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/i);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-registry spec before confirming and never calls the executor", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginAddHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect", "git+https://evil/x"],
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/git\+https:\/\/evil\/x/);
    expect(calls).toHaveLength(0);
  });
});

describe("plugin_add dispatch + reporting", () => {
  it("sends names with bundled:false, restart:true and reports the restart", async () => {
    const { executor, calls } = recordingExecutor(restarted);
    const result = await createPluginAddHandler(executor)({
      response_format: "concise",
      names: ["unraid-api-plugin-connect"],
      confirm: true,
    });
    expect(calls[0]?.document).toBe(PluginAddDocument);
    expect(calls[0]?.variables).toEqual({
      input: { names: ["unraid-api-plugin-connect"], bundled: false, restart: true },
    });
    expect(firstText(result)).toMatch(
      /Add of unraid-api-plugin-connect submitted; the Unraid API is restarting/,
    );
    expect(firstText(result)).not.toMatch(/installed/);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createPluginAddHandler(throwingExecutor("E404"))({
      response_format: "concise",
      names: ["nope"],
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to add plugin\(s\) nope: E404/);
  });
});
