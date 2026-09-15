import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Logger } from "pino";

/** How long a session may sit idle before the sweeper closes it. */
export const SESSION_IDLE_EXPIRY_MS = 300_000;

/** How often the idle sweeper runs. */
export const SESSION_SWEEP_INTERVAL_MS = 60_000;

const STATUS_NOT_FOUND = 404;
const STATUS_BAD_REQUEST = 400;
const JSON_RPC_INVALID_REQUEST = -32600;

/** The subset of the SDK transport the session store depends on. Test seam. */
export interface TransportLike {
  handleRequest(request: IncomingMessage, response: ServerResponse, body?: unknown): Promise<void>;
  close(): Promise<void>;
}

/** Builds a transport whose initialize callback reports the new session id. */
export type TransportFactory = (onInitialized: (sessionId: string) => void) => TransportLike;

/** Configuration for the session store. */
export interface SessionStoreOptions {
  buildServer: () => McpServer;
  logger: Logger;
  allowedHosts?: string[];
  now?: () => number;
  buildTransport?: TransportFactory;
}

/** One live session. */
interface SessionRecord {
  transport: TransportLike;
  server: McpServer;
  lastSeenAt: number;
}

/** True when the JSON-RPC body is (or contains) an `initialize` request. */
export function isInitializeRequest(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body];
  return messages.some(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { method?: unknown }).method === "initialize",
  );
}

/** Reads the MCP session id header, when present. */
function readSessionId(request: IncomingMessage): string | undefined {
  const header = request.headers?.["mcp-session-id"];
  return typeof header === "string" && header.length > 0 ? header : undefined;
}

/** Writes a JSON-RPC-shaped error for session routing failures. */
function writeSessionError(response: ServerResponse, status: number, message: string): void {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    error: { code: JSON_RPC_INVALID_REQUEST, message },
    id: null,
  });
  response.writeHead(status, { "content-type": "application/json" }).end(body);
}

/**
 * Stateful streamable-HTTP session manager: one MCP server + SSE-capable
 * transport per session, routed by the `mcp-session-id` header, with idle
 * expiry and DELETE teardown. This is what lets server-initiated messages
 * (progress, elicitation, resource updates) reach HTTP clients.
 */
export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly now: () => number;
  private readonly buildTransport: TransportFactory;

  /**
   * @param options - Server factory, logger, and injectable transport/clock.
   */
  constructor(private readonly options: SessionStoreOptions) {
    this.now = options.now ?? Date.now;
    this.buildTransport =
      options.buildTransport ?? ((onInitialized) => this.realTransport(onInitialized));
  }

  /**
   * Routes one HTTP request to its session, creating a session for
   * `initialize` requests and tearing one down on DELETE.
   *
   * @param request - The incoming HTTP request.
   * @param response - The HTTP response to write.
   * @param body - The parsed JSON body (undefined for GET/DELETE).
   * @returns Resolves once the transport has written a response.
   */
  async handle(request: IncomingMessage, response: ServerResponse, body: unknown): Promise<void> {
    const sessionId = readSessionId(request);
    if (sessionId) {
      await this.handleExisting({ sessionId, request, response, body });
      return;
    }
    if (!isInitializeRequest(body)) {
      writeSessionError(
        response,
        STATUS_BAD_REQUEST,
        "Missing mcp-session-id header; initialize a session first",
      );
      return;
    }
    await this.createSession(request, response, body);
  }

  /** Number of live sessions (diagnostics + tests). */
  size(): number {
    return this.sessions.size;
  }

  /** Closes every session idle past the expiry window. */
  sweep(): void {
    for (const [id, record] of this.sessions) {
      if (this.now() - record.lastSeenAt > SESSION_IDLE_EXPIRY_MS) {
        void this.remove(id);
      }
    }
  }

  /** Routes to a known session, expiring it on DELETE. */
  private async handleExisting(input: {
    sessionId: string;
    request: IncomingMessage;
    response: ServerResponse;
    body: unknown;
  }): Promise<void> {
    const record = this.sessions.get(input.sessionId);
    if (!record) {
      writeSessionError(input.response, STATUS_NOT_FOUND, "Session not found or expired");
      return;
    }
    record.lastSeenAt = this.now();
    await record.transport.handleRequest(input.request, input.response, input.body);
    if (input.request.method === "DELETE") {
      await this.remove(input.sessionId);
    }
  }

  /** Builds a server + transport pair and registers it on initialization. */
  private async createSession(
    request: IncomingMessage,
    response: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const server = this.options.buildServer();
    // biome-ignore lint/style/useConst: assigned below, referenced by the callback closure.
    let transport: TransportLike;
    const onInitialized = (sessionId: string) => {
      this.sessions.set(sessionId, { transport, server, lastSeenAt: this.now() });
      this.options.logger.info(`MCP session ${sessionId} started`);
    };
    transport = this.buildTransport(onInitialized);
    await server.connect(transport as never);
    await transport.handleRequest(request, response, body);
  }

  /** Closes and forgets one session; close failures are logged, not thrown. */
  private async remove(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }
    this.sessions.delete(sessionId);
    try {
      await record.transport.close();
      await record.server.close();
    } catch (error) {
      this.options.logger.warn({ err: error }, `Failed to close MCP session ${sessionId}`);
    }
  }

  /** The real SDK transport: session ids, SSE responses, rebinding guard. */
  private realTransport(onInitialized: (sessionId: string) => void): TransportLike {
    return new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: false,
      enableDnsRebindingProtection: this.options.allowedHosts !== undefined,
      allowedHosts: this.options.allowedHosts,
      onsessioninitialized: onInitialized,
    });
  }
}
