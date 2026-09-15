import { describe, expect, it } from "vitest";
import { PluginInstallPlgDocument } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createPluginInstallPlgHandler } from "./plugin-install-plg.js";

const bothFlags = { confirm: true, acknowledge_risk: true } as const;
const PLG_URL = "https://raw.githubusercontent.com/example/repo/main/example.plg";

describe("plugin_install_plg", () => {
  it("rejects a non-.plg URL before the gate and any query", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createPluginInstallPlgHandler(executor);

    const result = await handler({ url: "https://example.com/plugin.zip", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain(".plg");
    expect(calls).toHaveLength(0);
  });

  it("refuses without both flags and runs nothing", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createPluginInstallPlgHandler(executor);

    const result = await handler({ url: PLG_URL, confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });

  it("queues the install and points at plugin_list for verification", async () => {
    const { executor, calls } = recordingExecutor({
      unraidPlugins: {
        installPlugin: { id: "op-1", url: PLG_URL, name: "example", status: "QUEUED" },
      },
    });
    const handler = createPluginInstallPlgHandler(executor);

    const result = await handler({ url: PLG_URL, name: "example", ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(calls[0].document).toBe(PluginInstallPlgDocument);
    expect(calls[0].variables).toEqual({
      input: { url: PLG_URL, name: "example", forced: undefined },
    });
    expect(firstText(result)).toContain("QUEUED");
    expect(firstText(result)).toContain("plugin_list");
  });

  it("maps executor failures to a clean error", async () => {
    const handler = createPluginInstallPlgHandler(throwingExecutor("download failed"));

    const result = await handler({ url: PLG_URL, ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("download failed");
  });
});
