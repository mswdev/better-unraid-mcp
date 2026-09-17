import type { Logger } from "pino";
import { type Env, loadEnv } from "./config/env.js";
import { UnraidClient } from "./graphql/client.js";
import { LiveSnapshotStore } from "./graphql/live-store.js";
import { CachingExecutor } from "./graphql/snapshot-cache.js";
import { SubscriptionFeed } from "./graphql/subscription-feed.js";
import { createLogger } from "./logging.js";
import { loadSchemaVersion } from "./resources/schema-sdl.js";
import { buildServer } from "./server.js";
import { type ShellExecutor, SshShellExecutor } from "./shell/executor.js";
import { registerSecretValues } from "./tools/_shared/redact.js";
import type { RegistryOptions } from "./tools/registry.js";
import { SessionStore } from "./transport/http-sessions.js";
import { startHttp } from "./transport/http.js";
import { startStdio } from "./transport/stdio.js";

/** Logs late/unexpected failures so a single bad event cannot silently crash the server. */
function installProcessGuards(logger: Logger): void {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (error) => {
    logger.error({ err: error }, "Uncaught exception");
    process.exit(1);
  });
}

/** Builds the SSH executor when configured, or `null` for GraphQL-only setups. */
function buildShellExecutor(env: Env): ShellExecutor | null {
  if (!env.UNRAID_SSH_HOST) {
    return null;
  }
  return new SshShellExecutor({
    host: env.UNRAID_SSH_HOST,
    port: env.UNRAID_SSH_PORT,
    username: env.UNRAID_SSH_USER,
    password: env.UNRAID_SSH_PASSWORD,
    privateKeyPath: env.UNRAID_SSH_KEY_PATH,
    idleSeconds: env.UNRAID_SSH_IDLE_SECONDS,
  });
}

/** Wires config → client → server → transport and starts the MCP server. */
async function main(): Promise<void> {
  const env = loadEnv();
  registerSecretValues([env.UNRAID_API_KEY, env.UNRAID_SSH_PASSWORD, env.MCP_HTTP_BEARER_TOKEN]);
  const logger = createLogger(env.LOG_LEVEL);
  installProcessGuards(logger);
  const client = new UnraidClient({
    endpoint: env.UNRAID_API_URL,
    apiKey: env.UNRAID_API_KEY,
    allowSelfSigned: env.UNRAID_ALLOW_SELF_SIGNED,
  });
  const shell = buildShellExecutor(env);
  const executor = new CachingExecutor(client);
  const feed = new SubscriptionFeed({ endpoint: env.UNRAID_API_URL, apiKey: env.UNRAID_API_KEY });
  const liveStore = new LiveSnapshotStore();
  const registryOptions = {
    client: executor,
    shell,
    readOnly: env.MCP_READ_ONLY,
    schemaApiVersion: loadSchemaVersion(),
    feed,
    liveStore,
  };

  if (env.MCP_TRANSPORT === "http") {
    await startHttpTransport(env, registryOptions, logger);
    return;
  }
  await startStdio(buildServer(registryOptions), logger);
}

/** Starts the HTTP transport with its auth warning and optional session store. */
async function startHttpTransport(
  env: Env,
  registryOptions: RegistryOptions,
  logger: Logger,
): Promise<void> {
  if (!env.MCP_HTTP_BEARER_TOKEN) {
    logger.warn(
      "HTTP transport is running WITHOUT authentication (MCP_HTTP_ALLOW_UNAUTHENTICATED=true)",
    );
  }
  const buildForRequest = () => buildServer(registryOptions);
  const sessionStore = env.MCP_HTTP_SESSIONS
    ? new SessionStore({
        buildServer: buildForRequest,
        allowedHosts: env.MCP_HTTP_ALLOWED_HOSTS,
        logger,
      })
    : undefined;
  await startHttp({
    buildServer: buildForRequest,
    port: env.MCP_HTTP_PORT,
    host: env.MCP_HTTP_HOST,
    allowedHosts: env.MCP_HTTP_ALLOWED_HOSTS,
    bearerToken: env.MCP_HTTP_BEARER_TOKEN,
    sessionStore,
    logger,
  });
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
