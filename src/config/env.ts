import { z } from "zod";

const TRANSPORTS = ["stdio", "http"] as const;
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const DEFAULT_HTTP_PORT = 3000;

const EnvSchema = z.object({
  UNRAID_API_URL: z.string().url(),
  UNRAID_API_KEY: z.string().min(1),
  MCP_TRANSPORT: z.enum(TRANSPORTS).default("stdio"),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(DEFAULT_HTTP_PORT),
  UNRAID_ALLOW_SELF_SIGNED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});

/** Validated server configuration. */
export type Env = z.infer<typeof EnvSchema>;

/**
 * Validates and returns the server configuration, throwing a descriptive
 * error listing every invalid field. Fail-fast at startup.
 *
 * @param source - Raw environment record (defaults to `process.env`).
 * @returns The parsed, typed configuration.
 * @throws Error when any field is missing or invalid.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${issues}`);
}
