import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import { McpServer } from "@modelcontextprotocol/server";
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type HttpServerFactory,
  type HttpTransportOptions,
  readJsonBody,
  requestPath,
  routeRequest,
  startHttp,
} from "./http.js";
import {
  SESSION_IDLE_EXPIRY_MS,
  SESSION_SWEEP_INTERVAL_MS,
  SessionStore,
} from "./http-sessions.js";

/** Builds a fake IncomingMessage that yields `body` as a single chunk. */
function fakeRequest(
  method: string | undefined,
  url: string | undefined,
  body?: string,
): IncomingMessage {
  async function* chunks() {
    if (body !== undefined) {
      yield Buffer.from(body);
    }
  }
  return { method, url, [Symbol.asyncIterator]: chunks } as unknown as IncomingMessage;
}

/** Builds a fake ServerResponse that records the status and body it is given. */
function fakeResponse() {
  const calls = { status: 0, body: "" };
  const response = {
    headersSent: false,
    writeHead(status: number) {
      calls.status = status;
      this.headersSent = true;
      return this;
    },
    end(body?: string) {
      if (body) {
        calls.body = body;
      }
    },
    on() {
      return this;
    },
  };
  return { response: response as unknown as ServerResponse, calls };
}

const noopLogger = { error() {}, info() {} } as unknown as Logger;

const options: HttpTransportOptions = {
  buildServer: () => ({}) as McpServer,
  port: 0,
  host: "127.0.0.1",
  logger: noopLogger,
};

describe("requestPath", () => {
  it("strips the query string", () => {
    expect(requestPath(fakeRequest("POST", "/mcp?foo=bar"))).toBe("/mcp");
  });

  it("strips a trailing slash", () => {
    expect(requestPath(fakeRequest("POST", "/mcp/"))).toBe("/mcp");
  });
});

describe("readJsonBody", () => {
  it("parses a valid JSON body", async () => {
    const parsed = await readJsonBody(fakeRequest("POST", "/mcp", '{"a":1}'), 1000);

    expect(parsed).toEqual({ a: 1 });
  });

  it("returns undefined for an empty body", async () => {
    const parsed = await readJsonBody(fakeRequest("POST", "/mcp"), 1000);

    expect(parsed).toBeUndefined();
  });

  it("throws SyntaxError on malformed JSON", async () => {
    await expect(readJsonBody(fakeRequest("POST", "/mcp", "{ not json"), 1000)).rejects.toThrow(
      SyntaxError,
    );
  });
});

describe("routeRequest", () => {
  it("returns 404 for a non-/mcp path", async () => {
    const { response, calls } = fakeResponse();

    await routeRequest(fakeRequest("POST", "/other"), response, options);

    expect(calls.status).toBe(404);
  });

  it("returns 404 for a non-POST method", async () => {
    const { response, calls } = fakeResponse();

    await routeRequest(fakeRequest("GET", "/mcp"), response, options);

    expect(calls.status).toBe(404);
  });

  it("returns 400 on a malformed JSON body without throwing", async () => {
    const { response, calls } = fakeResponse();

    await routeRequest(fakeRequest("POST", "/mcp", "{ not json"), response, options);

    expect(calls.status).toBe(400);
    expect(calls.body).toContain("Parse error");
  });

  it("returns 413 when the body exceeds the size cap", async () => {
    const { response, calls } = fakeResponse();
    const huge = "x".repeat(2_000_000);

    await routeRequest(fakeRequest("POST", "/mcp", huge), response, options);

    expect(calls.status).toBe(413);
  });
});

/** Builds a fake IncomingMessage with headers, yielding `body` as one chunk. */
function fakeAuthedRequest(headers: Record<string, string>, body = "{}"): IncomingMessage {
  const request = fakeRequest("POST", "/mcp", body) as IncomingMessage & {
    headers: Record<string, string>;
  };
  request.headers = headers;
  return request;
}

describe("routeRequest bearer auth", () => {
  const authedOptions: HttpTransportOptions = { ...options, bearerToken: "expected-token" };

  it("rejects a request with no Authorization header", async () => {
    const { response, calls } = fakeResponse();

    await routeRequest(fakeAuthedRequest({}), response, authedOptions);

    expect(calls.status).toBe(401);
    expect(calls.body).toContain("Unauthorized");
  });

  it("rejects a wrong token", async () => {
    const { response, calls } = fakeResponse();

    await routeRequest(
      fakeAuthedRequest({ authorization: "Bearer wrong-token" }),
      response,
      authedOptions,
    );

    expect(calls.status).toBe(401);
  });

  it("rejects a non-bearer scheme", async () => {
    const { response, calls } = fakeResponse();

    await routeRequest(fakeAuthedRequest({ authorization: "Basic abc" }), response, authedOptions);

    expect(calls.status).toBe(401);
  });

  it("passes a correct token through to the MCP handler", async () => {
    const { response, calls } = fakeResponse();

    await routeRequest(
      fakeAuthedRequest({ authorization: "Bearer expected-token" }),
      response,
      authedOptions,
    );

    expect(calls.status).not.toBe(401);
  });
});

describe("requestPath and method edge cases", () => {
  it("treats a request without a URL as the root path", () => {
    expect(requestPath(fakeRequest("POST", undefined))).toBe("/");
  });

  it("returns 404 for a request without a method in session mode", async () => {
    const { response, calls } = fakeResponse();
    const sessionStore = new SessionStore({
      buildServer: () => ({}) as McpServer,
      logger: noopLogger,
    });

    await routeRequest(fakeRequest(undefined, "/mcp"), response, { ...options, sessionStore });

    expect(calls.status).toBe(404);
  });

  it("only ends a response whose headers were already sent when the handler fails", async () => {
    let wroteHead = false;
    let ended = false;
    const response = {
      headersSent: true,
      writeHead() {
        wroteHead = true;
        return this;
      },
      end() {
        ended = true;
      },
      on() {
        return this;
      },
    } as unknown as ServerResponse;

    await routeRequest(fakeRequest("POST", "/mcp", "{}"), response, options);

    expect(wroteHead).toBe(false);
    expect(ended).toBe(true);
  });
});

/**
 * A real IncomingMessage/ServerResponse pair over an in-memory socket: the
 * SDK transport runs for real, but no listener or network is involved.
 */
function memoryExchange(method: string, extra: { body?: unknown; sessionId?: string } = {}) {
  const written: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      written.push(Buffer.from(chunk));
      callback();
    },
  });
  const request = new IncomingMessage(socket as never);
  const headers: Record<string, string> = {
    host: "localhost",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(extra.sessionId ? { "mcp-session-id": extra.sessionId } : {}),
  };
  Object.assign(request, {
    method,
    url: "/mcp",
    headers,
    rawHeaders: Object.entries(headers).flat(),
  });
  if (extra.body !== undefined) {
    request.push(JSON.stringify(extra.body));
  }
  request.push(null);
  // Set by the HTTP parser on a real server; without it, reading the body destroys the socket.
  request.complete = true;
  const response = new ServerResponse(request);
  response.assignSocket(socket as never);
  return { request, response, raw: () => Buffer.concat(written).toString("utf8") };
}

const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

const buildRealServer = () => new McpServer({ name: "test-server", version: "1.0.0" });

describe("routeRequest with the real SDK transport", () => {
  it("answers a stateless initialize through a fresh server and transport", async () => {
    const exchange = memoryExchange("POST", { body: initializeRequest });

    await routeRequest(exchange.request, exchange.response, {
      ...options,
      buildServer: buildRealServer,
    });

    expect(exchange.raw()).toMatch(/^HTTP\/1\.1 200 OK/);
    expect(exchange.raw()).toContain('"serverInfo":{"name":"test-server","version":"1.0.0"}');
  });

  it("closes the per-request server once the response closes", async () => {
    let server: McpServer | undefined;
    const exchange = memoryExchange("POST", { body: initializeRequest });
    const buildServer = () => {
      server = buildRealServer();
      return server;
    };
    await routeRequest(exchange.request, exchange.response, { ...options, buildServer });

    exchange.response.emit("close");
    await new Promise((resolve) => setImmediate(resolve));

    expect(server?.isConnected()).toBe(false);
  });

  it("opens a session on initialize and tears it down on DELETE", async () => {
    const sessionStore = new SessionStore({ buildServer: buildRealServer, logger: noopLogger });
    const sessionOptions = { ...options, sessionStore };
    const opened = memoryExchange("POST", { body: initializeRequest });
    await routeRequest(opened.request, opened.response, sessionOptions);
    const sessionId = /mcp-session-id: (\S+)/i.exec(opened.raw())?.[1];
    const sizeAfterOpen = sessionStore.size();

    const closed = memoryExchange("DELETE", { sessionId });
    await routeRequest(closed.request, closed.response, sessionOptions);

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sizeAfterOpen).toBe(1);
    expect(sessionStore.size()).toBe(0);
  });
});

/** A recording logger: info lines and error messages. */
function recordingLogger() {
  const infos: string[] = [];
  const errors: string[] = [];
  const logger = {
    info: (message: string) => infos.push(message),
    error: (_details: unknown, message: string) => errors.push(message),
    warn() {},
  } as unknown as Logger;
  return { logger, infos, errors };
}

/** A fake node:http server: captures the request listener and scripts listen's outcome. */
function fakeHttpServer(outcome: "listening" | Error) {
  const captured: {
    listener?: (request: IncomingMessage, response: ServerResponse) => void;
    boundTo?: string;
  } = {};
  const factory: HttpServerFactory = (listener) => {
    captured.listener = listener;
    let onError: ((error: Error) => void) | undefined;
    return {
      on: (_event, errorListener) => {
        onError = errorListener;
      },
      listen: (port, host, onListening) => {
        captured.boundTo = `${host}:${port}`;
        if (outcome === "listening") {
          onListening();
          return;
        }
        onError?.(outcome);
      },
    };
  };
  return { factory, captured };
}

/** A response whose first writeHead throws (a client that already hung up). */
function hungUpResponse(headersSent: boolean) {
  const calls = { attempts: 0, statuses: [] as number[] };
  const response = {
    headersSent,
    writeHead(status: number) {
      calls.attempts += 1;
      if (calls.attempts === 1) {
        throw new Error("socket hang up");
      }
      calls.statuses.push(status);
      return this;
    },
    end() {},
  } as unknown as ServerResponse;
  return { response, calls };
}

describe("startHttp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("binds the configured host and port and logs readiness", async () => {
    const { logger, infos } = recordingLogger();
    const { factory, captured } = fakeHttpServer("listening");

    await startHttp({ ...options, host: "0.0.0.0", port: 8080, logger }, factory);

    expect(captured.boundTo).toBe("0.0.0.0:8080");
    expect(infos).toEqual(["better-unraid-mcp ready (http transport on 0.0.0.0:8080/mcp)"]);
  });

  it("rejects and logs when the server cannot bind", async () => {
    const { logger, errors } = recordingLogger();
    const { factory } = fakeHttpServer(new Error("EADDRINUSE"));

    await expect(startHttp({ ...options, logger }, factory)).rejects.toThrow("EADDRINUSE");
    expect(errors).toEqual(["HTTP server error"]);
  });

  it("schedules no session sweeper in stateless mode", async () => {
    vi.useFakeTimers();
    const { factory } = fakeHttpServer("listening");

    await startHttp(options, factory);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("sweeps idle sessions on an interval in session mode", async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const sessionStore = new SessionStore({
      buildServer: () =>
        ({ connect: async () => {}, close: async () => {} }) as unknown as McpServer,
      logger: noopLogger,
      now: () => nowMs,
      buildTransport: (onInitialized) => ({
        handleRequest: async () => onInitialized("session-1"),
        close: async () => {},
      }),
    });
    await sessionStore.handle(
      fakeRequest("POST", "/mcp"),
      fakeResponse().response,
      initializeRequest,
    );
    const { factory } = fakeHttpServer("listening");
    await startHttp({ ...options, sessionStore }, factory);

    nowMs = SESSION_IDLE_EXPIRY_MS + 1;
    await vi.advanceTimersByTimeAsync(SESSION_SWEEP_INTERVAL_MS);

    expect(sessionStore.size()).toBe(0);
  });

  it("logs a routing crash and answers 500 when no headers were sent", async () => {
    const { logger, errors } = recordingLogger();
    const { factory, captured } = fakeHttpServer("listening");
    await startHttp({ ...options, logger }, factory);
    const { response, calls } = hungUpResponse(false);

    captured.listener?.(fakeRequest("GET", "/elsewhere"), response);
    await new Promise((resolve) => setImmediate(resolve));

    expect(errors).toEqual(["Fatal error routing MCP request"]);
    expect(calls.statuses).toEqual([500]);
  });

  it("logs a routing crash without rewriting a response that already started", async () => {
    const { logger, errors } = recordingLogger();
    const { factory, captured } = fakeHttpServer("listening");
    await startHttp({ ...options, logger }, factory);
    const { response, calls } = hungUpResponse(true);

    captured.listener?.(fakeRequest("GET", "/elsewhere"), response);
    await new Promise((resolve) => setImmediate(resolve));

    expect(errors).toEqual(["Fatal error routing MCP request"]);
    expect(calls.attempts).toBe(1);
  });
});
