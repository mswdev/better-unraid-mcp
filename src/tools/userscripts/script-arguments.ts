import { z } from "zod";
import { quoteForShell } from "../_shared/quote-shell.js";

/** Most positional arguments one `user_script_run` call may pass. */
export const MAX_SCRIPT_ARGUMENTS = 32;

/** Most characters (JavaScript string length) one argument may hold. */
export const MAX_SCRIPT_ARGUMENT_LENGTH = 4_096;

/** Most characters (JavaScript string length) all arguments may hold together. */
export const MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH = 16_384;

/** A POSIX argv entry is a C string, so it ends at the first NUL and can never carry one. */
const NUL_CHARACTER = "\0";

/** Adds up the characters (JavaScript string length) of every argument. */
function totalLength(scriptArguments: string[]): number {
  return scriptArguments.reduce((sum, scriptArgument) => sum + scriptArgument.length, 0);
}

const scriptArgumentSchema = z
  .string()
  .max(MAX_SCRIPT_ARGUMENT_LENGTH, {
    error: `A script argument can be at most ${MAX_SCRIPT_ARGUMENT_LENGTH} characters.`,
  })
  .refine((scriptArgument) => !scriptArgument.includes(NUL_CHARACTER), {
    error:
      "A script argument cannot contain a NUL character (\\0): a POSIX argument cannot carry one.",
  })
  .describe(
    "One positional argument, passed to the script literally: spaces, quotes, and shell metacharacters are kept as plain text.",
  );

/**
 * The optional `args` input of `user_script_run`. Validation happens here, at
 * the SDK boundary, so an oversized or NUL-carrying list is rejected before
 * the handler (and its SSH command) ever runs. The count and per-item caps
 * also appear in the emitted JSON schema; the total cap and the NUL rule are
 * refinements JSON schema cannot express, so the description spells them out.
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
    error: `Script arguments can total at most ${MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH} characters.`,
  })
  .default([])
  .describe(
    `Optional positional arguments for the script, in order. Every item becomes exactly one argument ($1, $2, ...) passed literally, not a shell expression: nothing in it is expanded or run. Omit for no arguments. At most ${MAX_SCRIPT_ARGUMENTS} items, ${MAX_SCRIPT_ARGUMENT_LENGTH} characters each and ${MAX_TOTAL_SCRIPT_ARGUMENTS_LENGTH} in total; NUL characters are rejected. The arguments are shown in the confirmation prompt, so never use them for secrets.`,
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
