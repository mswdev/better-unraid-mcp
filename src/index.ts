import { loadEnv } from "./config/env.js";
import { UnraidClient } from "./graphql/client.js";
import { createLogger } from "./logging.js";
import { buildServer } from "./server.js";
import { startHttp } from "./transport/http.js";
import { startStdio } from "./transport/stdio.js";

/** Wires config → client → server → transport and starts the MCP server. */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const client = new UnraidClient({
    endpoint: env.UNRAID_API_URL,
    apiKey: env.UNRAID_API_KEY,
    allowSelfSigned: env.UNRAID_ALLOW_SELF_SIGNED,
  });

  if (env.MCP_TRANSPORT === "http") {
    await startHttp(() => buildServer(client), env.MCP_HTTP_PORT, logger);
    return;
  }
  await startStdio(buildServer(client), logger);
}

main().catch((error) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
