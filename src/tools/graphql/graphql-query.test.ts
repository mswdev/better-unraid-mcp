import { describe, expect, it } from "vitest";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createGraphqlQueryHandler } from "./graphql-query.js";

describe("graphql_query", () => {
  it("runs a valid query and returns the raw JSON data", async () => {
    const { executor, calls } = recordingExecutor({ online: true });
    const handler = createGraphqlQueryHandler(executor);

    const result = await handler({ query: "query { online }" });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(firstText(result))).toEqual({ online: true });
    expect(calls).toHaveLength(1);
  });

  it("passes variables through to the executor", async () => {
    const { executor, calls } = recordingExecutor({ logFile: { path: "/var/log/syslog" } });
    const handler = createGraphqlQueryHandler(executor);

    await handler({
      query: "query Read($path: String!) { logFile(path: $path) { path } }",
      variables: { path: "/var/log/syslog" },
    });

    expect(calls[0]?.variables).toEqual({ path: "/var/log/syslog" });
  });

  it("rejects a mutation and points at graphql_mutation without calling the API", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlQueryHandler(executor);

    const result = await handler({ query: "mutation { recalculateOverview { total } }" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("graphql_mutation");
    expect(calls).toHaveLength(0);
  });

  it("rejects a subscription without calling the API", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlQueryHandler(executor);

    const result = await handler({ query: "subscription { arraySubscription { id } }" });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("reports a syntax error readably", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlQueryHandler(executor);

    const result = await handler({ query: "query { unbalanced" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("GraphQL query failed");
    expect(calls).toHaveLength(0);
  });

  it("rejects a document containing multiple operations", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlQueryHandler(executor);

    const result = await handler({ query: "query A { online } query B { online }" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("exactly one");
    expect(calls).toHaveLength(0);
  });

  it("maps executor failures to a tool error", async () => {
    const handler = createGraphqlQueryHandler(throwingExecutor("FORBIDDEN"));

    const result = await handler({ query: "query { online }" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("FORBIDDEN");
  });
});
