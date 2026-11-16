import { describe, expect, it } from "vitest";
import {
  MAX_SHARE_NAME_LENGTH,
  validateExistingShareName,
  validateNewShareName,
} from "./share-name.js";

/**
 * Names that could escape a path or a shell command, or that the rule
 * refuses to stay conservative. Each must be rejected by BOTH validators.
 */
const DANGEROUS_NAMES: Array<[string, string]> = [
  ["a path separator", "media/../../etc"],
  ["a bare slash", "/"],
  ["a backslash", "media\\x"],
  ["a parent reference", ".."],
  ["the current directory", "."],
  ["an embedded parent reference", "a..b"],
  ["a single quote", "it's"],
  ["a double quote", 'say "hi"'],
  ["a backtick", "a`id`"],
  ["a dollar sign", "$HOME"],
  ["command substitution", "a$(id)"],
  ["a semicolon", "media; rm -rf /"],
  ["a pipe", "media|cat"],
  ["an ampersand", "media&id"],
  ["a glob star", "media*"],
  ["a newline", "media\nrm"],
  ["a carriage return", "media\r"],
  ["a tab", "my\tshare"],
  ["a NUL byte", "media\u0000"],
  ["a DEL character", "media\u007f"],
  ["a leading hyphen", "-rf"],
  ["a leading space", " media"],
  ["a trailing space", "media "],
  ["a hidden name", ".hidden"],
  ["a non-ASCII letter", "Müller"],
  ["an empty name", ""],
  ["an over-long name", "a".repeat(MAX_SHARE_NAME_LENGTH + 1)],
];

describe("validateExistingShareName", () => {
  it.each([
    "media",
    "TV Shows",
    "My Backups 2024",
    "two  spaces",
    "appdata",
    "a_b-c.d",
    "2024 photos",
    "a".repeat(MAX_SHARE_NAME_LENGTH),
  ])("accepts %j", (name) => {
    expect(validateExistingShareName(name)).toBeNull();
  });

  it.each(DANGEROUS_NAMES)("rejects %s", (_label, name) => {
    expect(validateExistingShareName(name)).not.toBeNull();
  });

  it("explains each structural rule", () => {
    expect(validateExistingShareName("")).toBe("Share name is empty.");
    expect(validateExistingShareName("a".repeat(MAX_SHARE_NAME_LENGTH + 1))).toMatch(/40/);
    expect(validateExistingShareName(".hidden")).toMatch(/dot/);
    expect(validateExistingShareName("-rf")).toMatch(/hyphen/);
    expect(validateExistingShareName(" media")).toMatch(/space/);
    expect(validateExistingShareName("a..b")).toMatch(/"\.\."/);
  });

  it("names the allowed characters when the set is the problem", () => {
    expect(validateExistingShareName("it's")).toBe(
      "Share names may only contain letters, digits, spaces, dot, underscore, and hyphen.",
    );
  });
});

describe("validateNewShareName", () => {
  it("accepts a plain name", () => {
    expect(validateNewShareName("media")).toBeNull();
  });

  it("rejects spaces in a new name, as Unraid's web UI does", () => {
    expect(validateNewShareName("my share")).toBe(
      "New share names may only contain letters, digits, dot, underscore, and hyphen (no spaces).",
    );
  });

  it.each(DANGEROUS_NAMES)("rejects %s", (_label, name) => {
    expect(validateNewShareName(name)).not.toBeNull();
  });
});
