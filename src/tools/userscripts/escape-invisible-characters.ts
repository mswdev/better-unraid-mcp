/**
 * Every code point a reader cannot be trusted to see for what it is. This is
 * an allowlist: anything other than a letter (L), number (N), punctuation
 * mark (P), symbol (S), or the plain space U+0020 matches, which covers
 * controls, format characters (bidi overrides and isolates, zero-width
 * characters, U+FEFF, tag characters), separators, non-ASCII spaces,
 * combining and enclosing marks (which can overlay neighbouring text),
 * private-use and unassigned code points. The second alternative adds the
 * code points that render blank despite a visible-looking category: Unicode's
 * default-ignorables (Hangul fillers are letters, variation selectors and the
 * combining grapheme joiner) and the braille blank U+2800 (a symbol).
 */
const UNTRUSTED_FOR_DISPLAY = /[^\p{L}\p{N}\p{P}\p{S} ]|[\p{Default_Ignorable_Code_Point}\u2800]/gu;

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
 * Makes text safe to show a human who is approving it: every code point that
 * could be invisible or alter how nearby text renders (see
 * UNTRUSTED_FOR_DISPLAY) becomes a visible JSON-style `\uXXXX` escape. Plain
 * letters, digits, punctuation, symbols, and the ordinary space are left
 * alone. An astral code point such as a tag character becomes both of its
 * UTF-16 code units. Use it on display copy only, never on what actually
 * runs. Applied to `JSON.stringify` output, the result is still JSON that
 * parses back to the original value.
 *
 * Zero-width joiner (U+200D) is a format character and variation selectors
 * are default-ignorable, so an emoji ZWJ sequence or an emoji with a
 * presentation selector displays partly escaped (for example 👩 U+200D 💻),
 * and so does text with combining marks (decomposed accents, many Indic
 * scripts). That costs some readability, which is the right trade in a
 * prompt that gates arbitrary code.
 *
 * @param text - The text to display, typically `JSON.stringify` output.
 * @returns The text with every untrusted-for-display code point escaped.
 * @example escapeInvisibleCharacters('["a\u202eb"]') // '["a\\u202eb"]'
 */
export function escapeInvisibleCharacters(text: string): string {
  return text.replace(UNTRUSTED_FOR_DISPLAY, escapeCodePoint);
}
