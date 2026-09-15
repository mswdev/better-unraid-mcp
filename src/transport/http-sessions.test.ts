import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import {
  SESSION_IDLE_EXPIRY_MS,
  SessionStore,
  type TransportLike,
  isInitializeRequest,
} from "./http-sessions.js";

const noopLogger = { error() {}, info() {}, warn() {} } as unknown as Logger;

function fakeRequest(method: string, sessionId?: string): IncomingMessage {
  return {
    method,
    url: "/mcp",
    headers: sessionId ? { "mcp-session-id": sessionId } : {},
  } as unknown as IncomingMessage;
}

function fakeResponse() {
  const calls = { status: 0, body: "" };
  const response = {
    headersSent: false,
    writeHead(status: number) {
      calls.status = status;
      return this;
    },
    end(body?: string) {
      if (body) {
        calls.body = body;
      }
    },
  };
  return { response: response as unknown as ServerResponse, calls };
}

const fakeServer = () =>
  ({ connect: async () => {}, close: async () => {} }) as unknown as McpServer;

/** Transport factory that self-assigns ids and records handled requests. */
function fakeTransportFactory() {
  const handled: unknown[] = [];
  const closed: string[] = [];
  let counter = 0;
  const factory = (onInitialized: (id: string) => void): TransportLike => {
    counter += 1;
    const id = `session-${counter}`;
    return {
      handleRequest: async (_request, _response, body) => {
        handled.push(body);
        onInitialized(id);
      },
      close: async () => {
        closed.push(id);
      },
    };
  };
  return { factory, handled, closed };
}

function storeWith(now: () => number) {
  const transports = fakeTransportFactory();
  const store = new SessionStore({
    buildServer: fakeServer,
    logger: noopLogger,
    now,
    buildTransport: transports.factory,
  });
  return { store, transports };
}

const initializeBody = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };

describe("isInitializeRequest", () => {
  it("recognizes a single initialize request", () => {
    expect(isInitializeRequest(initializeBody)).toBe(true);
  });

  it("recognizes a batch containing initialize", () => {
    expect(isInitializeRequest([{ method: "ping" }, initializeBody])).toBe(true);
  });

  it("rejects other methods and non-objects", () => {
    expect(isInitializeRequest({ method: "tools/list" })).toBe(false);
    expect(isInitializeRequest("nope")).toBe(false);
  });
});

describe("SessionStore", () => {
  it("creates a session for an initialize request", async () => {
    const { store } = storeWith(() => 0);
    const { response } = fakeResponse();

    await store.handle(fakeRequest("POST"), response, initializeBody);

    expect(store.size()).toBe(1);
  });

  it("rejects a non-initialize request without a session id", async () => {
    const { store } = storeWith(() => 0);
    const { response, calls } = fakeResponse();

    await store.handle(fakeRequest("POST"), response, { method: "tools/list" });

    expect(calls.status).toBe(400);
    expect(calls.body).toContain("Missing mcp-session-id");
    expect(store.size()).toBe(0);
  });

  it("returns 404 for an unknown session id", async () => {
    const { store } = storeWith(() => 0);
    const { response, calls } = fakeResponse();

    await store.handle(fakeRequest("POST", "ghost"), response, { method: "tools/list" });

    expect(calls.status).toBe(404);
    expect(calls.body).toContain("Session not found");
  });

  it("routes follow-up requests to the session transport", async () => {
    const { store, transports } = storeWith(() => 0);

    await store.handle(fakeRequest("POST"), fakeResponse().response, initializeBody);
    await store.handle(fakeRequest("POST", "session-1"), fakeResponse().response, {
      method: "tools/list",
    });

    expect(transports.handled).toHaveLength(2);
    expect(transports.handled[1]).toEqual({ method: "tools/list" });
  });

  it("tears the session down on DELETE", async () => {
    const { store, transports } = storeWith(() => 0);

    await store.handle(fakeRequest("POST"), fakeResponse().response, initializeBody);
    await store.handle(fakeRequest("DELETE", "session-1"), fakeResponse().response, undefined);

    expect(store.size()).toBe(0);
    expect(transports.closed).toEqual(["session-1"]);
  });

  it("sweeps sessions idle past the expiry window", async () => {
    let nowMs = 0;
    const { store, transports } = storeWith(() => nowMs);

    await store.handle(fakeRequest("POST"), fakeResponse().response, initializeBody);
    nowMs = SESSION_IDLE_EXPIRY_MS + 1;
    store.sweep();
    await Promise.resolve();

    expect(store.size()).toBe(0);
    expect(transports.closed).toEqual(["session-1"]);
  });

  it("keeps recently-touched sessions through a sweep", async () => {
    let nowMs = 0;
    const { store } = storeWith(() => nowMs);

    await store.handle(fakeRequest("POST"), fakeResponse().response, initializeBody);
    nowMs = SESSION_IDLE_EXPIRY_MS - 1_000;
    await store.handle(fakeRequest("POST", "session-1"), fakeResponse().response, {
      method: "tools/list",
    });
    nowMs += 2_000;
    store.sweep();

    expect(store.size()).toBe(1);
  });
});
