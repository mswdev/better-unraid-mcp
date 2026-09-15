import { describe, expect, it } from "vitest";
import type { ApiKeyListQuery } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createApiKeyListHandler } from "./apikey-list.js";

const fixture = {
  apiKeys: [
    {
      id: "k1",
      name: "mcp-server",
      description: "better-unraid-mcp",
      roles: ["ADMIN"],
      createdAt: "2026-01-01T00:00:00Z",
      permissions: [{ resource: "ARRAY", actions: ["READ_ANY"] }],
    },
  ],
} satisfies ApiKeyListQuery;

describe("apikey_list", () => {
  it("lists keys with names and roles, never key values", async () => {
    const { executor } = recordingExecutor(fixture);
    const handler = createApiKeyListHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("mcp-server");
    expect(firstText(result)).toContain("ADMIN");
  });

  it("reports an empty key list", async () => {
    const { executor } = recordingExecutor({ apiKeys: [] } satisfies ApiKeyListQuery);
    const handler = createApiKeyListHandler(executor);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("No API keys");
  });

  it("maps executor failures to a clean error", async () => {
    const handler = createApiKeyListHandler(throwingExecutor("forbidden"));

    const result = await handler({ response_format: "concise" });

    expect(result.isError).toBe(true);
  });
});
