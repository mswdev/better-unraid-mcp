import { describe, expect, it } from "vitest";
import { escapeInvisibleCharacters } from "./escape-invisible-characters.js";

describe("escapeInvisibleCharacters", () => {
  it.each([
    {
      label: "a right-to-left override (U+202E)",
      raw: "safe\u202Ehs.exe",
      shown: "safe\\u202ehs.exe",
    },
    { label: "a left-to-right isolate (U+2066)", raw: "a\u2066b", shown: "a\\u2066b" },
    { label: "a zero-width space (U+200B)", raw: "re\u200Bstart", shown: "re\\u200bstart" },
    { label: "a byte order mark (U+FEFF)", raw: "\uFEFFrestart", shown: "\\ufeffrestart" },
    { label: "a line separator (U+2028)", raw: "one\u2028two", shown: "one\\u2028two" },
    { label: "a no-break space (U+00A0)", raw: "two\u00A0words", shown: "two\\u00a0words" },
    { label: "an ideographic space (U+3000)", raw: "two\u3000words", shown: "two\\u3000words" },
    { label: "a C1 control (U+0085)", raw: "a\u0085b", shown: "a\\u0085b" },
    { label: "DEL (U+007F)", raw: "a\u007Fb", shown: "a\\u007fb" },
    { label: "a tag character (U+E0041)", raw: "a\u{E0041}b", shown: "a\\udb40\\udc41b" },
    { label: "a Hangul filler (U+3164)", raw: "re\u3164start", shown: "re\\u3164start" },
    { label: "a Hangul choseong filler (U+115F)", raw: "a\u115Fb", shown: "a\\u115fb" },
    { label: "a combining grapheme joiner (U+034F)", raw: "a\u034Fb", shown: "a\\u034fb" },
    { label: "a variation selector (U+FE0F)", raw: "a\uFE0Fb", shown: "a\\ufe0fb" },
    { label: "a combining acute accent (U+0301)", raw: "cafe\u0301", shown: "cafe\\u0301" },
    { label: "an enclosing circle (U+20DD)", raw: "ok\u20DD", shown: "ok\\u20dd" },
    { label: "the braille blank (U+2800)", raw: "re\u2800start", shown: "re\\u2800start" },
    { label: "a private-use code point (U+E000)", raw: "a\uE000b", shown: "a\\ue000b" },
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

  it("leaves letters from other scripts and visible symbols alone", () => {
    const text = "привет 世界 ½ € ±";

    const escaped = escapeInvisibleCharacters(text);

    expect(escaped).toBe(text);
  });

  it("escapes the joiner inside an emoji ZWJ sequence", () => {
    const technologist = "👩\u200D💻";

    const escaped = escapeInvisibleCharacters(technologist);

    expect(escaped).toBe("👩\\u200d💻");
  });

  it("keeps escaped JSON parseable back to the original value", () => {
    const original = ["safe\u202Ehs.exe", "a\u{E0041}b", "two\u00A0words"];

    const escaped = escapeInvisibleCharacters(JSON.stringify(original));

    expect(JSON.parse(escaped)).toEqual(original);
  });
});
