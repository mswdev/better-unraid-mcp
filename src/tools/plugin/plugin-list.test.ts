import { describe, expect, it } from "vitest";
import { PluginListDocument, type PluginListQuery } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, rejectingExecutor } from "../_shared/test-support.js";
import { createPluginListHandler } from "./plugin-list.js";

const populated = {
  plugins: [
    {
      name: "unraid-api-plugin-connect",
      version: "4.5.0",
      hasApiModule: true,
      hasCliModule: false,
    },
  ],
  installedUnraidPlugins: ["dynamix.plg", "ca.plg"],
} satisfies PluginListQuery;

const empty = { plugins: [], installedUnraidPlugins: [] } satisfies PluginListQuery;

describe("plugin_list", () => {
  it("selects both plugins and installedUnraidPlugins in one query", async () => {
    const { executor, calls } = recordingExecutor(populated);
    await createPluginListHandler(executor)({ response_format: "concise" });
    expect(calls[0]?.document).toBe(PluginListDocument);
  });

  it("summarizes api + OS plugins concisely", async () => {
    const { executor } = recordingExecutor(populated);
    const result = await createPluginListHandler(executor)({ response_format: "concise" });
    const text = firstText(result);
    expect(text).toMatch(/1 api plugin\(s\): unraid-api-plugin-connect/);
    expect(text).toMatch(/2 OS \.plg: dynamix\.plg, ca\.plg/);
  });

  it("never asserts a flat zero for an empty result (ambiguous upstream)", async () => {
    const { executor } = recordingExecutor(empty);
    const text = firstText(await createPluginListHandler(executor)({ response_format: "concise" }));
    expect(text).toMatch(/0 api plugins reported \(may also indicate safe mode/);
    expect(text).toMatch(/0 OS \.plg reported \(may also indicate an unreadable/);
  });

  it("returns detailed JSON when requested", async () => {
    const { executor } = recordingExecutor(populated);
    const text = firstText(
      await createPluginListHandler(executor)({ response_format: "detailed" }),
    );
    expect(JSON.parse(text)).toEqual(populated);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createPluginListHandler(rejectingExecutor("boom"))({
      response_format: "concise",
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to list plugins: boom/);
  });
});
