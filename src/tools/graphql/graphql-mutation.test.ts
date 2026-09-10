import { describe, expect, it } from "vitest";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createGraphqlMutationHandler } from "./graphql-mutation.js";

const ARCHIVE_ALL = "mutation { archiveAll { total } }";

describe("graphql_mutation", () => {
  it("refuses without confirm and never calls the API", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: ARCHIVE_ALL });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('"confirm": true');
    expect(calls).toHaveLength(0);
  });

  it("runs a confirmed mutation and returns the raw JSON data", async () => {
    const { executor, calls } = recordingExecutor({ archiveAll: { total: 3 } });
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: ARCHIVE_ALL, confirm: true });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(firstText(result))).toEqual({ archiveAll: { total: 3 } });
    expect(calls).toHaveLength(1);
  });

  it("passes variables through to the executor", async () => {
    const { executor, calls } = recordingExecutor({ ok: true });
    const handler = createGraphqlMutationHandler(executor);

    await handler({
      mutation: "mutation Remove($id: PrefixedID!) { deleteNotification(id: $id) { total } }",
      variables: { id: "abc" },
      confirm: true,
    });

    expect(calls[0]?.variables).toEqual({ id: "abc" });
  });

  it("rejects a query operation and points at graphql_query", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: "query { online }", confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("graphql_query");
    expect(calls).toHaveLength(0);
  });

  it("reports a syntax error readably without calling the API", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: "mutation {", confirm: true });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("maps executor failures to a tool error", async () => {
    const handler = createGraphqlMutationHandler(throwingExecutor("FORBIDDEN"));

    const result = await handler({ mutation: ARCHIVE_ALL, confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("FORBIDDEN");
  });
});
