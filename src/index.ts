import type { Logger } from "pino";
import { type Env, loadEnv } from "./config/env.js";
import { UnraidClient } from "./graphql/client.js";
import { createLogger } from "./logging.js";
import { buildServer } from "./server.js";
import { type ShellExecutor, SshShellExecutor } from "./shell/executor.js";
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
  });
}

/** Wires config → client → server → transport and starts the MCP server. */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  installProcessGuards(logger);
  const client = new UnraidClient({
    endpoint: env.UNRAID_API_URL,
    apiKey: env.UNRAID_API_KEY,
    allowSelfSigned: env.UNRAID_ALLOW_SELF_SIGNED,
  });
  const shell = buildShellExecutor(env);

  if (env.MCP_TRANSPORT === "http") {
    await startHttp({
      buildServer: () => buildServer(client, shell),
      port: env.MCP_HTTP_PORT,
      host: env.MCP_HTTP_HOST,
      allowedHosts: env.MCP_HTTP_ALLOWED_HOSTS,
      logger,
    });
    return;
  }
  await startStdio(buildServer(client, shell), logger);
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
