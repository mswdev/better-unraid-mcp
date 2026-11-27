/**
 * Code points that are invisible or that change how nearby text renders:
 * controls (Cc, including DEL and the C1 block), format characters (Cf:
 * bidi overrides and isolates, zero-width characters, U+FEFF, tag
 * characters), line and paragraph separators (Zl, Zp), and spaces (Zs).
 */
const INVISIBLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/gu;

/** The one space a reader can see for what it is, so it is left alone. */
const PLAIN_SPACE = " ";

/** Base of the digits in a `\uXXXX` escape (hexadecimal). */
const HEX_RADIX = 16;

/** Digits in a `\uXXXX` escape: one UTF-16 code unit, zero-padded to four. */
const CODE_UNIT_HEX_DIGITS = 4;

/** Writes one UTF-16 code unit as a JSON-style `\uXXXX` escape. */
function escapeCodeUnit(codeUnit: number): string {
  return `\\u${codeUnit.toString(HEX_RADIX).padStart(CODE_UNIT_HEX_DIGITS, "0")}`;
}

/** Escapes every UTF-16 code unit of one code point (two for an astral one). */
function escapeCodePoint(codePoint: string): string {
  const codeUnits = Array.from({ length: codePoint.length }, (_, index) =>
    codePoint.charCodeAt(index),
  );
  return codeUnits.map(escapeCodeUnit).join("");
}

/**
 * Makes text safe to show a human who is approving it: every invisible or
 * rendering-altering code point (see INVISIBLE_CHARACTER) becomes a visible
 * JSON-style `\uXXXX` escape, except the plain space U+0020. An astral code
 * point such as a tag character becomes both of its UTF-16 code units. Use
 * it on display copy only, never on what actually runs. Applied to
 * `JSON.stringify` output, the result is still JSON that parses back to the
 * original value.
 *
 * Zero-width joiner (U+200D) is a format character, so an emoji ZWJ
 * sequence displays with its joiners escaped (for example "👩‍💻").
 * That costs some readability, which is the right trade in a prompt that
 * gates arbitrary code.
 *
 * @param text - The text to display, typically `JSON.stringify` output.
 * @returns The text with every invisible or formatting code point escaped.
 * @example escapeInvisibleCharacters('["a‮b"]') // '["a\\u202eb"]'
 */
export function escapeInvisibleCharacters(text: string): string {
  return text.replace(INVISIBLE_CHARACTER, (codePoint) =>
    codePoint === PLAIN_SPACE ? codePoint : escapeCodePoint(codePoint),
  );
}
