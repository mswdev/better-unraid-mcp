import { createHash, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
import type { Logger } from "pino";
import { SESSION_SWEEP_INTERVAL_MS, type SessionStore } from "./http-sessions.js";

const MCP_PATH = "/mcp";
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;
const STATUS_NOT_FOUND = 404;
const STATUS_PAYLOAD_TOO_LARGE = 413;
const STATUS_SERVER_ERROR = 500;
const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INTERNAL_ERROR = -32603;
const JSON_RPC_UNAUTHORIZED = -32001;
const MAX_BODY_BYTES = 1_000_000;
const BEARER_PREFIX = "Bearer ";

/** Options controlling the stateless Streamable HTTP server. */
export interface HttpTransportOptions {
  buildServer: () => McpServer;
  port: number;
  host: string;
  allowedHosts?: string[];
  /**
   * Static token every request must present as `Authorization: Bearer <token>`;
   * omit only for an explicitly unauthenticated server.
   */
  bearerToken?: string;
  /** When present, requests are routed through stateful MCP sessions. */
  sessionStore?: SessionStore;
  logger: Logger;
}

/** HTTP methods the session-mode endpoint accepts (GET carries the SSE stream). */
const SESSION_METHODS = new Set(["POST", "GET", "DELETE"]);

/** True when the method is acceptable for the configured mode. */
function isSupportedMethod(method: string | undefined, sessions: boolean): boolean {
  if (sessions) {
    return SESSION_METHODS.has(method ?? "");
  }
  return method === "POST";
}

/** Thrown when a request body exceeds the configured size limit. */
export class PayloadTooLargeError extends Error {}

/**
 * Reads a request body up to `maxBytes`, parsing it as JSON.
 *
 * @param request - The incoming HTTP request stream.
 * @param maxBytes - Maximum number of bytes to buffer before rejecting.
 * @returns The parsed JSON body, or `undefined` for an empty body.
 * @throws PayloadTooLargeError when the body exceeds `maxBytes`.
 * @throws SyntaxError when the body is not valid JSON.
 */
export async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      throw new PayloadTooLargeError("Request body too large");
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : undefined;
}

/**
 * Returns the request's path without query string or trailing slash.
 *
 * @param request - The incoming HTTP request.
 * @returns The normalized pathname (e.g. `/mcp`).
 */
export function requestPath(request: IncomingMessage): string {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** Writes a JSON-RPC error response, unless headers were already sent. */
function writeJsonRpcError(
  response: ServerResponse,
  details: { status: number; code: number; message: string },
): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    error: { code: details.code, message: details.message },
    id: null,
  });
  response.writeHead(details.status, { "content-type": "application/json" }).end(body);
}

/** Constant-time token comparison over fixed-length digests (no length leak). */
function tokensMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/** Extracts the bearer token from the Authorization header, if present. */
function extractBearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers?.authorization;
  if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  return header.slice(BEARER_PREFIX.length);
}

/** True when no token is required, or the request presents the right one. */
function isAuthorized(request: IncomingMessage, expectedToken: string | undefined): boolean {
  if (expectedToken === undefined) {
    return true;
  }
  const provided = extractBearerToken(request);
  return provided !== undefined && tokensMatch(provided, expectedToken);
}

/** Writes a 401 with a WWW-Authenticate challenge, JSON-RPC shaped. */
function writeUnauthorized(response: ServerResponse): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: JSON_RPC_UNAUTHORIZED,
      message: "Unauthorized: missing or invalid bearer token",
    },
    id: null,
  });
  response
    .writeHead(STATUS_UNAUTHORIZED, {
      "content-type": "application/json",
      "www-authenticate": "Bearer",
    })
    .end(body);
}

/** Writes a plain 404 with a diagnostic hint. */
function writeNotFound(response: ServerResponse): void {
  const body = JSON.stringify({ error: "Not found. POST JSON-RPC to /mcp." });
  response.writeHead(STATUS_NOT_FOUND, { "content-type": "application/json" }).end(body);
}

/** Builds a per-request transport, enabling DNS-rebinding protection when hosts are allow-listed. */
function buildTransport(allowedHosts?: string[]): NodeStreamableHTTPServerTransport {
  return new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: allowedHosts !== undefined,
    allowedHosts,
  });
}

/** Handles a single POST /mcp request through a fresh server + transport. */
async function handleMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpTransportOptions,
): Promise<void> {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const server = options.buildServer();
  const transport = buildTransport(options.allowedHosts);
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, body);
}

/** Sends the request through the session store when enabled, else stateless. */
async function dispatchMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpTransportOptions,
): Promise<void> {
  if (options.sessionStore) {
    const body =
      request.method === "POST" ? await readJsonBody(request, MAX_BODY_BYTES) : undefined;
    await options.sessionStore.handle(request, response, body);
    return;
  }
  await handleMcpRequest(request, response, options);
}

/**
 * Routes one HTTP request, mapping parse/size/internal failures to clean
 * error responses instead of crashing the process.
 *
 * @param request - The incoming HTTP request.
 * @param response - The HTTP response to write.
 * @param options - The transport options (server factory, allowed hosts, logger).
 * @returns A promise that resolves once a response has been written.
 */
export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpTransportOptions,
): Promise<void> {
  const sessions = options.sessionStore !== undefined;
  if (!isSupportedMethod(request.method, sessions) || requestPath(request) !== MCP_PATH) {
    writeNotFound(response);
    return;
  }
  if (!isAuthorized(request, options.bearerToken)) {
    writeUnauthorized(response);
    return;
  }
  try {
    await dispatchMcpRequest(request, response, options);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      writeJsonRpcError(response, {
        status: STATUS_PAYLOAD_TOO_LARGE,
        code: JSON_RPC_PARSE_ERROR,
        message: "Request body too large",
      });
      return;
    }
    if (error instanceof SyntaxError) {
      writeJsonRpcError(response, {
        status: STATUS_BAD_REQUEST,
        code: JSON_RPC_PARSE_ERROR,
        message: "Parse error",
      });
      return;
    }
    options.logger.error({ err: error }, "Unhandled error in MCP HTTP handler");
    writeJsonRpcError(response, {
      status: STATUS_SERVER_ERROR,
      code: JSON_RPC_INTERNAL_ERROR,
      message: "Internal server error",
    });
  }
}

/**
 * Starts a stateless Streamable HTTP server. Each POST /mcp builds a fresh
 * server + transport (no session state) and returns a single JSON response.
 *
 * @param options - Server factory, bind host/port, allowed hosts, and logger.
 * @returns A promise that resolves once the server is listening.
 * @throws Error when the server cannot bind to the requested host/port.
 */
export function startHttp(options: HttpTransportOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const httpServer = createServer((request, response) => {
      routeRequest(request, response, options).catch((error) => {
        options.logger.error({ err: error }, "Fatal error routing MCP request");
        if (!response.headersSent) {
          response.writeHead(STATUS_SERVER_ERROR).end();
        }
      });
    });
    httpServer.on("error", (error) => {
      options.logger.error({ err: error }, "HTTP server error");
      reject(error);
    });
    if (options.sessionStore) {
      const sweeper = setInterval(() => options.sessionStore?.sweep(), SESSION_SWEEP_INTERVAL_MS);
      sweeper.unref?.();
    }
    httpServer.listen(options.port, options.host, () => {
      options.logger.info(
        `better-unraid-mcp ready (http transport on ${options.host}:${options.port}${MCP_PATH})`,
      );
      resolve();
    });
  });
}
