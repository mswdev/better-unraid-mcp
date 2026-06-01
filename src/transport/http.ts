import { type IncomingMessage, createServer } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Logger } from "pino";

const MCP_PATH = "/mcp";
const NOT_FOUND = 404;

/** Reads and JSON-parses a request body. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

/**
 * Starts a stateless Streamable HTTP server. Each POST /mcp builds a fresh
 * server + transport (no session state) and returns a single JSON response.
 */
export async function startHttp(
  buildServer: () => McpServer,
  port: number,
  logger: Logger,
): Promise<void> {
  const httpServer = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== MCP_PATH) {
      response.writeHead(NOT_FOUND).end();
      return;
    }
    const body = await readJsonBody(request);
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  });
  httpServer.listen(port, () =>
    logger.info(`better-unraid-mcp ready (http transport on :${port}${MCP_PATH})`),
  );
}
