import { describe, expect, it } from "vitest";
import {
  firstText,
  recordingShell,
  rejectingShell,
  throwingShell,
} from "../_shared/test-support.js";
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

describe("user_script_list failure paths", () => {
  it("reports SSH unavailable without a shell", async () => {
    const handler = createUserScriptListHandler(null);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("maps an SSH failure to a clean error", async () => {
    const handler = createUserScriptListHandler(throwingShell("connection refused"));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("Failed to list user scripts over SSH: connection refused");
  });

  it("reports a non-Error SSH rejection as text", async () => {
    const handler = createUserScriptListHandler(rejectingShell("channel closed"));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("Failed to list user scripts over SSH: channel closed");
  });
});
