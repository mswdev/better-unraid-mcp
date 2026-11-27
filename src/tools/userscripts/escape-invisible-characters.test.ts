import { describe, expect, it } from "vitest";
import { escapeInvisibleCharacters } from "./escape-invisible-characters.js";

describe("escapeInvisibleCharacters", () => {
  it.each([
    { label: "a right-to-left override (U+202E)", raw: "safe‮hs.exe", shown: "safe\\u202ehs.exe" },
    { label: "a left-to-right isolate (U+2066)", raw: "a⁦b", shown: "a\\u2066b" },
    { label: "a zero-width space (U+200B)", raw: "re​start", shown: "re\\u200bstart" },
    { label: "a byte order mark (U+FEFF)", raw: "﻿restart", shown: "\\ufeffrestart" },
    { label: "a line separator (U+2028)", raw: "one two", shown: "one\\u2028two" },
    { label: "a no-break space (U+00A0)", raw: "two words", shown: "two\\u00a0words" },
    { label: "an ideographic space (U+3000)", raw: "two　words", shown: "two\\u3000words" },
    { label: "a C1 control (U+0085)", raw: "a\u0085b", shown: "a\\u0085b" },
    { label: "DEL (U+007F)", raw: "a\u007Fb", shown: "a\\u007fb" },
    { label: "a tag character (U+E0041)", raw: "a\u{E0041}b", shown: "a\\udb40\\udc41b" },
  ])("escapes $label", ({ raw, shown }) => {
    const escaped = escapeInvisibleCharacters(raw);

    expect(escaped).toBe(shown);
  });

  it("leaves plain ASCII, including the ordinary space, alone", () => {
    const text = `["restart","cloudflared --wait 30","it's ok"]`;

    const escaped = escapeInvisibleCharacters(text);

    expect(escaped).toBe(text);
  });

  it("leaves accented letters and emoji alone", () => {
    const text = "héllo wörld 🚀";

    const escaped = escapeInvisibleCharacters(text);

    expect(escaped).toBe(text);
  });

  it("escapes the joiner inside an emoji ZWJ sequence", () => {
    const technologist = "👩‍💻";

    const escaped = escapeInvisibleCharacters(technologist);

    expect(escaped).toBe("👩\\u200d💻");
  });

  it("keeps escaped JSON parseable back to the original value", () => {
    const original = ["safe‮hs.exe", "a\u{E0041}b", "two words"];

    const escaped = escapeInvisibleCharacters(JSON.stringify(original));

    expect(JSON.parse(escaped)).toEqual(original);
  });
});
