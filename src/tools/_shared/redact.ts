/** Replacement marker for anything redacted. */
const REDACTED = "[redacted]";

/**
 * Key-value shapes whose value must never surface: JSON members and
 * env-style assignments whose key names a credential. The replacement keeps
 * the captured key/delimiter and re-quotes the value, so redacted JSON stays
 * parseable.
 */
const KEY_VALUE_PATTERN =
  /("?[\w-]*(?:api[_-]?key|password|token|secret|authorization)"?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,}"']+)/gi;

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
