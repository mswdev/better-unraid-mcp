import type { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import {
  createElicitationChannel,
  type ElicitationChannel,
  type ElicitationOutcome,
  type ElicitationPrompt,
} from "../_shared/elicitation.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createGraphqlMutationHandler } from "./graphql-mutation.js";

const ARCHIVE_ALL = "mutation { archiveAll { unread { total } } }";
const STOP_ARRAY = "mutation { array { setState(input: { desiredState: STOP }) { state } } }";

/** Channel fake answering every prompt with one scripted outcome and recording each prompt. */
function recordingChannel(outcome: ElicitationOutcome) {
  const prompts: ElicitationPrompt[] = [];
  const channel: ElicitationChannel = {
    isAvailable: () => true,
    confirm: async (prompt) => {
      prompts.push(prompt);
      return outcome;
    },
  };
  return { channel, prompts };
}

/** The form a fake client submits back, and the forms it was asked to fill. */
interface ElicitingServer {
  server: McpServer;
  requiredFields: string[][];
}

/**
 * A minimal McpServer fake whose client supports elicitation and submits the
 * given form, so a test drives the real channel's "every box ticked" rule.
 */
function elicitingServer(content: Record<string, unknown>): ElicitingServer {
  const requiredFields: string[][] = [];
  const server = {
    server: {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: async (params: { requestedSchema: { required: string[] } }) => {
        requiredFields.push(params.requestedSchema.required);
        return { action: "accept", content };
      },
    },
  } as unknown as McpServer;
  return { server, requiredFields };
}

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
    const { executor, calls } = recordingExecutor({ archiveAll: { unread: { total: 3 } } });
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: ARCHIVE_ALL, confirm: true });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(firstText(result))).toEqual({ archiveAll: { unread: { total: 3 } } });
    expect(calls).toHaveLength(1);
  });

  it("passes variables through to the executor", async () => {
    const { executor, calls } = recordingExecutor({ ok: true });
    const handler = createGraphqlMutationHandler(executor);

    await handler({
      mutation:
        "mutation Remove($id: PrefixedID!, $type: NotificationType!) { deleteNotification(id: $id, type: $type) { unread { total } } }",
      variables: { id: "abc", type: "UNREAD" },
      confirm: true,
    });

    expect(calls[0]?.variables).toEqual({ id: "abc", type: "UNREAD" });
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

describe("graphql_mutation risk gate", () => {
  it("refuses a dangerous mutation without acknowledge_risk and never calls the API", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: STOP_ARRAY, confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('"acknowledge_risk": true');
    expect(firstText(result)).toContain("setState");
    expect(calls).toHaveLength(0);
  });

  it("runs a dangerous mutation when both flags are set", async () => {
    const { executor, calls } = recordingExecutor({ array: { setState: { state: "STOPPED" } } });
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: STOP_ARRAY, confirm: true, acknowledge_risk: true });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("does not demand acknowledge_risk for benign mutations", async () => {
    const { executor, calls } = recordingExecutor({ archiveAll: { total: 1 } });
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: ARCHIVE_ALL, confirm: true });

    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("validates a dry_run without requiring confirm and sends nothing", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({ mutation: ARCHIVE_ALL, dry_run: true });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toContain("not sent");
    expect(calls).toHaveLength(0);
  });

  it("reports schema validation errors before the confirm gate and sends nothing", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createGraphqlMutationHandler(executor);

    const result = await handler({
      mutation: "mutation { archiveEverything { total } }",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("validation failed");
    expect(calls).toHaveLength(0);
  });
});

describe("graphql_mutation elicitation", () => {
  it("asks once, with both checkboxes, before running a risky mutation", async () => {
    const { executor, calls } = recordingExecutor({ array: { setState: { state: "STOPPED" } } });
    const { channel, prompts } = recordingChannel("accepted");
    const handler = createGraphqlMutationHandler(executor, channel);

    const result = await handler({ mutation: STOP_ARRAY });

    expect(result.isError).toBeUndefined();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].requireRiskAcknowledgement).toBe(true);
    expect(prompts[0].message).toContain("setState");
    expect(calls).toHaveLength(1);
  });

  it("runs a risky mutation after one prompt with both boxes ticked", async () => {
    const { executor, calls } = recordingExecutor({ array: { setState: { state: "STOPPED" } } });
    const { server, requiredFields } = elicitingServer({ confirm: true, acknowledge_risk: true });
    const handler = createGraphqlMutationHandler(executor, createElicitationChannel(server));

    const result = await handler({ mutation: STOP_ARRAY });

    expect(result.isError).toBeUndefined();
    expect(requiredFields).toEqual([["confirm", "acknowledge_risk"]]);
    expect(calls).toHaveLength(1);
  });

  it("requires both boxes: a risky prompt answered with confirm alone sends nothing", async () => {
    const { executor, calls } = recordingExecutor({});
    const { server, requiredFields } = elicitingServer({ confirm: true });
    const handler = createGraphqlMutationHandler(executor, createElicitationChannel(server));

    const result = await handler({ mutation: STOP_ARRAY });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("declined");
    expect(requiredFields).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it("changes nothing when the human declines the risky prompt", async () => {
    const { executor, calls } = recordingExecutor({});
    const { channel, prompts } = recordingChannel("declined");
    const handler = createGraphqlMutationHandler(executor, channel);

    const result = await handler({ mutation: STOP_ARRAY, confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(
      "The user declined the confirmation prompt. No changes were made.",
    );
    expect(prompts).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it("keeps the one-checkbox prompt for a benign mutation", async () => {
    const { executor, calls } = recordingExecutor({ archiveAll: { unread: { total: 0 } } });
    const { channel, prompts } = recordingChannel("accepted");
    const handler = createGraphqlMutationHandler(executor, channel);

    const result = await handler({ mutation: ARCHIVE_ALL });

    expect(result.isError).toBeUndefined();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].requireRiskAcknowledgement).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("falls back to the combined risk refusal when the prompt cannot be shown", async () => {
    const { executor, calls } = recordingExecutor({});
    const { channel } = recordingChannel("unavailable");
    const handler = createGraphqlMutationHandler(executor, channel);

    const result = await handler({ mutation: STOP_ARRAY });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe(
      'Refusing to run this mutation: it selects setState, which can stop the array, hard-kill a VM, or rewrite the system shutdown configuration. Re-call with both "confirm": true and "acknowledge_risk": true to proceed. No changes were made.',
    );
    expect(calls).toHaveLength(0);
  });
});

describe("graphql_mutation failure messages", () => {
  it("prefixes executor failures with the tool context", async () => {
    const handler = createGraphqlMutationHandler(throwingExecutor("socket hang up"));

    const result = await handler({ mutation: ARCHIVE_ALL, confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("GraphQL mutation failed: socket hang up");
  });
});
