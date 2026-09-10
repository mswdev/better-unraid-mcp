import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { describe, expect, it } from "vitest";
import { type HttpTransportOptions, readJsonBody, requestPath, routeRequest } from "./http.js";

/** Builds a fake IncomingMessage that yields `body` as a single chunk. */
function fakeRequest(method: string, url: string, body?: string): IncomingMessage {
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
