import { z } from "zod";

const TRANSPORTS = ["stdio", "http"] as const;
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_SSH_PORT = 22;
const DEFAULT_SSH_USER = "root";

/** Splits a comma-separated host list into a trimmed array, or `undefined` when empty. */
function parseAllowedHosts(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const hosts = value
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
  return hosts.length > 0 ? hosts : undefined;
}

const EnvSchema = z
  .object({
    UNRAID_API_URL: z.string().url(),
    UNRAID_API_KEY: z.string().min(1),
    MCP_TRANSPORT: z.enum(TRANSPORTS).default("stdio"),
    MCP_HTTP_PORT: z.coerce.number().int().positive().default(DEFAULT_HTTP_PORT),
    MCP_HTTP_HOST: z.string().min(1).default(DEFAULT_HTTP_HOST),
    MCP_HTTP_ALLOWED_HOSTS: z.string().optional().transform(parseAllowedHosts),
    UNRAID_ALLOW_SELF_SIGNED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    UNRAID_SSH_HOST: z.string().min(1).optional(),
    UNRAID_SSH_PORT: z.coerce.number().int().positive().default(DEFAULT_SSH_PORT),
    UNRAID_SSH_USER: z.string().min(1).default(DEFAULT_SSH_USER),
    UNRAID_SSH_PASSWORD: z.string().min(1).optional(),
    UNRAID_SSH_KEY_PATH: z.string().min(1).optional(),
  })
  .superRefine((env, context) => {
    if (env.UNRAID_SSH_HOST && !env.UNRAID_SSH_PASSWORD && !env.UNRAID_SSH_KEY_PATH) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["UNRAID_SSH_HOST"],
        message: "UNRAID_SSH_HOST requires UNRAID_SSH_PASSWORD or UNRAID_SSH_KEY_PATH",
      });
    }
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
