import { describe, expect, it } from "vitest";
import { firstText, recordingShell } from "../_shared/test-support.js";
import { createUserScriptListHandler } from "./user-script-list.js";

describe("user_script_list", () => {
  it("lists script names", async () => {
    const { shell } = recordingShell({ stdout: "backup\nclean cache\n", stderr: "", exitCode: 0 });
    const handler = createUserScriptListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("backup");
    expect(firstText(result)).toContain("clean cache");
  });

  it("reports a missing plugin cleanly", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 2 });
    const handler = createUserScriptListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("User Scripts plugin is not installed");
  });
});
