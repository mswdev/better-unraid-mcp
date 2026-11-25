/** Replacement marker for anything redacted. */
const REDACTED = "[redacted]";

/**
 * Key-value shapes whose value must never surface: JSON members and
 * env-style assignments whose key names a credential. The replacement keeps
 * the captured key/delimiter and re-quotes the value.
 *
 * The lookbehind lets a key start only where a run of word characters
 * begins. Without it, the engine retried `[\w-]*` from every position inside
 * a long run (a base64 blob, a line of dashes), which is quadratic: 1.4 s for
 * 30k characters. A key that starts mid-run would match from the run's start
 * anyway, so the matches are unchanged.
 */
const KEY_VALUE_PATTERN =
  /((?<![\w-])"?[\w-]*(?:api[_-]?key|password|token|secret|authorization)"?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,}"']+)/gi;

/**
 * Object keys whose scalar value is a credential: any key that ENDS in a
 * credential word, whatever comes before it (`x.password`, `Admin Password`,
 * a Docker label such as `com.example.api-key`), as the text pattern does.
 */
const CREDENTIAL_KEY_PATTERN = /(?:api[_-]?key|password|token|secret|authorization)$/i;

/**
 * Three dot-separated base64url segments starting with eyJ — a JWT. The
 * lookbehind keeps it linear for the same reason as KEY_VALUE_PATTERN: with
 * `\b`, a run like `eyJ-eyJ-…` started a full scan after every dash. A JWT
 * glued to a preceding word character or dash is no longer caught; one after
 * a space, quote, `=` or `:` (Bearer headers, assignments, JSON) still is.
 * Each segment is written as an exact count plus `*` rather than `{8,}`: on
 * one unbroken run of several MB, V8 overflows its stack on the counted
 * open-ended form (RangeError), while this equivalent form stays linear.
 */
const JWT_PATTERN = /(?<![\w-])eyJ[\w-]{8}[\w-]*\.[\w-]{8}[\w-]*\.[\w-]{4}[\w-]*\b/g;

let configuredSecrets: string[] = [];

/**
 * Registers literal secret values (API key, SSH password, bearer token) to
 * be stripped from every tool output. Call once at startup.
 *
 * @param values - Secret values; undefined/empty entries are ignored.
 */
export function registerSecretValues(values: Array<string | undefined>): void {
  configuredSecrets = values.filter((value): value is string => Boolean(value));
}

/** Clears registered secrets. Test-isolation helper. */
export function clearSecretValues(): void {
  configuredSecrets = [];
}

/**
 * Replaces every occurrence of each registered secret value, leaving existing
 * "[redacted]" markers alone. That makes a second pass a no-op even when a
 * secret is part of the marker itself (an SSH password of "red"), so text
 * redacted before it was measured cannot grow again afterwards.
 */
function redactConfiguredValues(text: string): string {
  let result = text;
  for (const secret of configuredSecrets) {
    result = replaceOutsideMarkers(result, secret);
  }
  return result;
}

/** Replaces one secret everywhere except inside "[redacted]" markers. */
function replaceOutsideMarkers(text: string, secret: string): string {
  return text
    .split(REDACTED)
    .map((segment) => segment.split(secret).join(REDACTED))
    .join(REDACTED);
}

/**
 * Redacts secrets from tool-facing text: registered literal values,
 * key-value shapes with credential-like key names, and JWT-shaped strings.
 *
 * @param text - The outgoing tool text.
 * @returns The text with secrets replaced by "[redacted]".
 */
export function redactSecrets(text: string): string {
  return redactConfiguredValues(text)
    .replace(KEY_VALUE_PATTERN, `$1"${REDACTED}"`)
    .replace(JWT_PATTERN, REDACTED);
}

/**
 * `JSON.stringify` replacer that redacts value by value. A scalar under a
 * credential-named key is replaced outright; every other string goes through
 * redactSecrets. Objects and arrays (even under a credential key) are walked
 * into rather than replaced, an object's keys are redacted too (a registered
 * secret can be a key), and null or undefined is kept (it carries no secret),
 * so the JSON keeps its shape.
 */
function redactJsonValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined || Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object") {
    return withRedactedKeys(value);
  }
  if (CREDENTIAL_KEY_PATTERN.test(key)) {
    return REDACTED;
  }
  return typeof value === "string" ? redactSecrets(value) : value;
}

/** A shallow copy of an object whose keys went through redactSecrets; JSON.stringify walks its values. */
function withRedactedKeys(record: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [redactSecrets(key), entry]),
  );
}

/**
 * Serializes a value to JSON with every secret redacted BEFORE serializing.
 * Running redactSecrets over already-serialized JSON breaks it: an escaped
 * quote (`PASSWORD=\"hunter2\"`) defeats the value pattern, leaving invalid
 * JSON with the secret still visible. Use this for every JSON tool output.
 *
 * @param value - The payload to serialize (anything JSON.stringify accepts).
 * @param indent - Spaces per indent level; omit for compact JSON.
 * @returns The redacted JSON text.
 * @example
 * stringifyRedacted({ stdout: 'PASSWORD="hunter2"' }); // '{"stdout":"PASSWORD=\\"[redacted]\\""}'
 * @see redactSecrets for plain (non-JSON) text.
 */
export function stringifyRedacted(value: unknown, indent?: number): string {
  return JSON.stringify(value, redactJsonValue, indent);
}
