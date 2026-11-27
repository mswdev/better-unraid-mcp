import { z } from "zod";
import { quoteForShell } from "../_shared/quote-shell.js";

/** Most positional arguments one `user_script_run` call may pass. */
export const MAX_SCRIPT_ARGUMENTS = 32;

/**
 * Most UTF-16 code units (JavaScript string length) one argument may hold;
 * most emoji count as two.
 */
export const MAX_SCRIPT_ARGUMENT_LENGTH = 4_096;

/**
 * Most UTF-16 code units (JavaScript string length) all arguments may hold
 * together; most emoji count as two.
 */
export const MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH = 16_384;

/**
 * A string with no NUL anywhere. A POSIX argv entry is a C string, so it ends
 * at the first NUL and can never carry one. As a `.regex()` check it is also
 * published as the item's JSON schema `pattern`, so clients can validate it.
 */
const WITHOUT_NUL_CHARACTER = /^[^\0]*$/;

/**
 * An unpaired UTF-16 surrogate. Under the `u` flag a correctly paired
 * surrogate is one astral code point (not Cs), so only broken halves match.
 * UTF-8 cannot encode them; the SSH command would carry U+FFFD instead.
 */
const LONE_SURROGATE = /\p{Cs}/u;

/** Adds up the UTF-16 code units (JavaScript string length) of every argument. */
function totalLength(scriptArguments: string[]): number {
  return scriptArguments.reduce((sum, scriptArgument) => sum + scriptArgument.length, 0);
}

/** Shared by both per-argument length checks below, so either reads the same. */
const ARGUMENT_TOO_LONG_MESSAGE = `A script argument can be at most ${MAX_SCRIPT_ARGUMENT_LENGTH} UTF-16 code units (most emoji count as two).`;

/**
 * `.max()` emits `maxLength` for clients, but zod measures it in code points
 * (an emoji counts as one), so the explicit `.length` refinement is what
 * enforces the UTF-16 cap. `abort` stops a string that fails both from being
 * reported twice (and skips the content checks for an oversized string).
 */
const scriptArgumentSchema = z
  .string()
  .max(MAX_SCRIPT_ARGUMENT_LENGTH, { error: ARGUMENT_TOO_LONG_MESSAGE, abort: true })
  .refine((scriptArgument) => scriptArgument.length <= MAX_SCRIPT_ARGUMENT_LENGTH, {
    error: ARGUMENT_TOO_LONG_MESSAGE,
  })
  .regex(WITHOUT_NUL_CHARACTER, {
    error:
      "A script argument cannot contain a NUL character (\\0): a POSIX argument cannot carry one.",
  })
  .refine((scriptArgument) => !LONE_SURROGATE.test(scriptArgument), {
    error:
      "A script argument cannot contain an unpaired UTF-16 surrogate: it cannot be sent as UTF-8, so the script would not receive it literally.",
  })
  .describe(
    "One positional argument, passed to the script literally: spaces, quotes, and shell metacharacters are kept as plain text.",
  );

/**
 * The optional `args` input of `user_script_run`. Validation happens here, at
 * the SDK boundary, so an oversized, NUL-carrying, or malformed list is
 * rejected before the handler (and its SSH command) ever runs. The count cap,
 * the per-item cap, and the NUL rule also appear in the emitted JSON schema
 * (`maxItems`, `maxLength`, `pattern`). The total cap and the lone-surrogate
 * rule are server-side refinements, so the description spells them out.
 *
 * @example
 * const inputSchema = z.object({ name: z.string(), args: scriptArgumentsSchema });
 * inputSchema.parse({ name: "backup" }).args; // []
 * @see formatScriptArguments
 */
export const scriptArgumentsSchema = z
  .array(scriptArgumentSchema)
  .max(MAX_SCRIPT_ARGUMENTS, {
    error: `A user script can receive at most ${MAX_SCRIPT_ARGUMENTS} arguments.`,
  })
  .refine((scriptArguments) => totalLength(scriptArguments) <= MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH, {
    error: `Script arguments can total at most ${MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH} UTF-16 code units (most emoji count as two).`,
  })
  .default([])
  .describe(
    `Optional positional arguments for the script, in order. Every item becomes exactly one argument ($1, $2, ...) passed literally, not a shell expression: nothing in it is expanded or run. Omit for no arguments. At most ${MAX_SCRIPT_ARGUMENTS} items, ${MAX_SCRIPT_ARGUMENT_LENGTH} UTF-16 code units each and ${MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH} in total (most emoji count as two); NUL characters and unpaired surrogates are rejected. The arguments are shown in the confirmation prompt, so never use them for secrets.`,
  );

/**
 * Turns validated arguments into the tail of a shell command: each argument
 * single-quoted on its own and separated by one space, so the remote shell
 * splits them back into exactly the same argv entries, in order, and expands
 * nothing inside them.
 *
 * Worst case for the SSH command size: a single quote expands to 4 bytes
 * (`'\''`), and every other UTF-16 code unit is at most 3 bytes of UTF-8, so
 * 32 arguments of 512 single quotes is the largest tail the bounds allow:
 * 65,631 bytes, about half of Linux's 131,072-byte MAX_ARG_STRLEN (sshd hands
 * the whole command to `$SHELL -c` as one argv string).
 *
 * @param scriptArguments - Arguments already checked by `scriptArgumentsSchema`.
 * @returns The quoted, space-separated arguments; an empty string for none.
 * @example formatScriptArguments(["restart", "it's"]) // "'restart' 'it'\\''s'"
 * @see scriptArgumentsSchema
 */
export function formatScriptArguments(scriptArguments: string[]): string {
  return scriptArguments.map(quoteForShell).join(" ");
}
