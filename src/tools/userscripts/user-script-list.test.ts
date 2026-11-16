import { describe, expect, it } from "vitest";
import { firstText, recordingShell, throwingShell } from "../_shared/test-support.js";
import {
  classifyListing,
  createUserScriptListHandler,
  PLUGIN_MISSING_EXIT,
} from "./user-script-list.js";

/** GNU ls's exit code for "cannot access the directory" (e.g. permission denied). */
const LS_SERIOUS_TROUBLE_EXIT = 2;

describe("user_script_list", () => {
  it("lists script names", async () => {
    const { shell } = recordingShell({ stdout: "backup\nclean cache\n", stderr: "", exitCode: 0 });
    const handler = createUserScriptListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("backup");
    expect(firstText(result)).toContain("clean cache");
  });

  it("lists the scripts directory, then checks the plugin's .plg, in one command", async () => {
    const { shell, calls } = recordingShell({ stdout: "backup\n", stderr: "", exitCode: 0 });
    const handler = createUserScriptListHandler(shell);

    await handler({ response_format: "concise" });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(
      "if [ -d '/boot/config/plugins/user.scripts/scripts' ]; then ls -1 -- '/boot/config/plugins/user.scripts/scripts' || exit $?; fi; [ -f '/boot/config/plugins/user.scripts.plg' ] || exit 3",
    );
  });

  it("reports a missing plugin cleanly", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: PLUGIN_MISSING_EXIT });
    const handler = createUserScriptListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(
      "The User Scripts plugin is not installed (no /boot/config/plugins/user.scripts.plg). Install it from Community Applications to use user_script_run.",
    );
  });

  it("says the plugin is installed but has no scripts, as an empty result rather than an error", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 0 });
    const handler = createUserScriptListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("installed but has no scripts yet");
    expect(firstText(result)).not.toContain("not installed");
  });

  it("returns an empty scripts array in detailed mode when the plugin has no scripts", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 0 });
    const handler = createUserScriptListHandler(shell);

    const result = await handler({ response_format: "detailed" });

    expect(JSON.parse(firstText(result))).toEqual({ scripts: [] });
  });
});

describe("classifyListing", () => {
  it("lists leftover scripts even when the plugin's .plg is gone", () => {
    const listing = classifyListing({
      stdout: "backup\n",
      stderr: "",
      exitCode: PLUGIN_MISSING_EXIT,
    });

    expect(listing).toEqual({ kind: "scripts", names: ["backup"] });
  });

  it("treats an empty listing with the .plg present as installed with no scripts", () => {
    const listing = classifyListing({ stdout: "\n", stderr: "", exitCode: 0 });

    expect(listing).toEqual({ kind: "no-scripts" });
  });

  it("treats an empty listing without the .plg as not installed", () => {
    const listing = classifyListing({ stdout: "", stderr: "", exitCode: PLUGIN_MISSING_EXIT });

    expect(listing).toEqual({ kind: "not-installed" });
  });

  it("reports an ls failure as a failure, never as 'not installed'", () => {
    const listing = classifyListing({
      stdout: "",
      stderr: "ls: cannot open directory: Permission denied\n",
      exitCode: LS_SERIOUS_TROUBLE_EXIT,
    });

    expect(listing).toEqual({
      kind: "failed",
      exitCode: LS_SERIOUS_TROUBLE_EXIT,
      detail: "ls: cannot open directory: Permission denied",
    });
  });
});

describe("user_script_list failure paths", () => {
  it("reports SSH unavailable without a shell", async () => {
    const handler = createUserScriptListHandler(null);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("SSH is not configured");
  });

  it("surfaces an ls failure with its exit code and stderr", async () => {
    const { shell } = recordingShell({
      stdout: "",
      stderr: "ls: cannot open directory: Permission denied",
      exitCode: LS_SERIOUS_TROUBLE_EXIT,
    });
    const handler = createUserScriptListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(
      "Could not list /boot/config/plugins/user.scripts/scripts (exit 2): ls: cannot open directory: Permission denied",
    );
  });

  it("says so when a failed listing wrote nothing to stderr", async () => {
    const { shell } = recordingShell({ stdout: "", stderr: "", exitCode: 1 });
    const handler = createUserScriptListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("(no error output)");
  });

  it("maps an SSH failure to a clean error", async () => {
    const handler = createUserScriptListHandler(throwingShell("connection refused"));

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe("Failed to list user scripts over SSH: connection refused");
  });
});
