import { describe, expect, it } from "vitest";
import {
  NAMES_SPEC,
  buildInvalidNameError,
  buildRestartReport,
  firstInvalidName,
} from "./_shared.js";

describe("NAMES_SPEC / firstInvalidName", () => {
  it("accepts bare and scoped package names", () => {
    expect(firstInvalidName(["lodash", "@unraid/shared", "unraid-api-plugin-connect"])).toBeNull();
  });

  it("rejects version suffixes (breaks the remove round-trip)", () => {
    expect(firstInvalidName(["foo@1.2.3"])).toBe("foo@1.2.3");
    expect(firstInvalidName(["foo@latest"])).toBe("foo@latest");
  });

  it("rejects URLs, git refs, paths, and user/repo shorthand", () => {
    for (const bad of [
      "git+https://e/x",
      "https://e/x.tgz",
      "file:/x",
      "/abs/path",
      "./rel",
      "user/repo",
    ]) {
      expect(firstInvalidName([bad])).toBe(bad);
    }
  });

  it("returns the first offending entry, scanning in order", () => {
    expect(firstInvalidName(["ok", "git+https://e/x", "also-ok"])).toBe("git+https://e/x");
  });

  it("matches NAMES_SPEC directly for a bare name", () => {
    expect(NAMES_SPEC.test("unraid-api-plugin-connect")).toBe(true);
  });
});

describe("buildInvalidNameError / buildRestartReport", () => {
  it("names the rejected entry and the action", () => {
    expect(buildInvalidNameError("add", "git+https://e/x")).toMatch(
      /Refusing to add "git\+https:\/\/e\/x"/,
    );
    expect(buildInvalidNameError("add", "x")).toMatch(/No changes were made/);
  });

  it("reports an auto-restart when no manual restart is required", () => {
    expect(buildRestartReport("add", ["a", "b"], false)).toBe(
      "Add of a, b submitted; the Unraid API is restarting to apply it. Verify with plugin_list once it reconnects.",
    );
  });

  it("reports a required manual restart", () => {
    expect(buildRestartReport("remove", ["a"], true)).toBe(
      "Remove of a submitted; a manual API restart is required to apply it. Verify with plugin_list after restarting.",
    );
  });
});
