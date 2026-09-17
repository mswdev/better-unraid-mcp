import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import type { McpServer } from "@modelcontextprotocol/server";
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
  /** True while a long-lived SSE (GET) stream is open — exempt from sweep. */
  streaming: boolean;
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
  if (response.headersSent) {
    response.end();
    return;
  }
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

  /** Closes every session idle past the expiry window (open streams exempt). */
  sweep(): void {
    for (const [id, record] of this.sessions) {
      if (!record.streaming && this.now() - record.lastSeenAt > SESSION_IDLE_EXPIRY_MS) {
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
    if (input.request.method === "GET") {
      this.trackStream(record, input.response);
    }
    await record.transport.handleRequest(input.request, input.response, input.body);
    if (input.request.method === "DELETE") {
      await this.remove(input.sessionId);
    }
  }

  /**
   * A GET opens the long-lived SSE stream: notifications flowing outward
   * never touch lastSeenAt, so the session is sweep-exempt until the stream
   * closes (then the idle clock restarts).
   */
  private trackStream(record: SessionRecord, response: ServerResponse): void {
    record.streaming = true;
    const listener = () => {
      record.streaming = false;
      record.lastSeenAt = this.now();
    };
    if (typeof response.on === "function") {
      response.on("close", listener);
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
    let initialized = false;
    const onInitialized = (sessionId: string) => {
      initialized = true;
      this.sessions.set(sessionId, { transport, server, lastSeenAt: this.now(), streaming: false });
      this.options.logger.info(`MCP session ${sessionId} started`);
    };
    transport = this.buildTransport(onInitialized);
    await server.connect(transport as never);
    await transport.handleRequest(request, response, body);
    if (!initialized) {
      // Failed initialization must not accumulate connected server/transport
      // pairs that no session entry will ever close.
      await this.closePair(transport, server, "(uninitialized)");
    }
  }

  /** Closes a transport/server pair; failures are logged, not thrown. */
  private async closePair(
    transport: TransportLike,
    server: McpServer,
    label: string,
  ): Promise<void> {
    try {
      await transport.close();
      await server.close();
    } catch (error) {
      this.options.logger.warn({ err: error }, `Failed to close MCP session ${label}`);
    }
  }

  /** Closes and forgets one session; close failures are logged, not thrown. */
  private async remove(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) {
      return;
    }
    this.sessions.delete(sessionId);
    await this.closePair(record.transport, record.server, sessionId);
  }

  /** The real SDK transport: session ids, SSE responses, rebinding guard. */
  private realTransport(onInitialized: (sessionId: string) => void): TransportLike {
    return new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: false,
      enableDnsRebindingProtection: this.options.allowedHosts !== undefined,
      allowedHosts: this.options.allowedHosts,
      onsessioninitialized: onInitialized,
    });
  }
}
