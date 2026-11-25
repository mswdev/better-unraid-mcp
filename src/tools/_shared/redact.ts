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
 * Object keys whose scalar value is a credential: the same key names
 * KEY_VALUE_PATTERN matches in text, anchored to the whole key.
 */
const CREDENTIAL_KEY_PATTERN = /^[\w-]*(?:api[_-]?key|password|token|secret|authorization)$/i;

/** Three dot-separated base64url segments starting with eyJ — a JWT. */
const JWT_PATTERN = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}\b/g;

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

/** Replaces every occurrence of each registered secret value. */
function redactConfiguredValues(text: string): string {
  let result = text;
  for (const secret of configuredSecrets) {
    result = result.split(secret).join(REDACTED);
  }
  return result;
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
 * into rather than replaced, and null or undefined is kept (it carries no
 * secret), so the JSON keeps its shape.
 */
function redactJsonValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined || typeof value === "object") {
    return value;
  }
  if (CREDENTIAL_KEY_PATTERN.test(key)) {
    return REDACTED;
  }
  return typeof value === "string" ? redactSecrets(value) : value;
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
