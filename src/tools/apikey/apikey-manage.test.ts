import { describe, expect, it } from "vitest";
import {
  ApiKeyAddRoleDocument,
  ApiKeyCreateDocument,
  ApiKeyDeleteDocument,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor, throwingExecutor } from "../_shared/test-support.js";
import { createApiKeyManageHandler } from "./apikey-manage.js";

const bothFlags = { confirm: true, acknowledge_risk: true } as const;

describe("apikey_manage validation and gate", () => {
  it("rejects create without a name before the gate", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({ action: "create", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("name");
    expect(calls).toHaveLength(0);
  });

  it("rejects add_role without exactly one role", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({
      action: "add_role",
      id: "k1",
      roles: ["ADMIN", "VIEWER"],
      ...bothFlags,
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("refuses without both flags and runs nothing", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({ action: "delete", ids: ["k1"], confirm: true });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("acknowledge_risk");
    expect(calls).toHaveLength(0);
  });
});

describe("apikey_manage actions", () => {
  it("creates a key and discloses its value exactly once, surviving redaction", async () => {
    const { executor, calls } = recordingExecutor({
      apiKey: {
        create: { id: "k9", name: "backup-agent", key: "0123abcd-value", roles: ["VIEWER"] },
      },
    });
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({
      action: "create",
      name: "backup-agent",
      roles: ["VIEWER"],
      ...bothFlags,
    });

    expect(calls[0].document).toBe(ApiKeyCreateDocument);
    expect(firstText(result)).toContain("0123abcd-value");
    expect(firstText(result)).toContain("shown once");
  });

  it("adds a role via the add-role document", async () => {
    const { executor, calls } = recordingExecutor({ apiKey: { addRole: true } });
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({ action: "add_role", id: "k1", roles: ["VIEWER"], ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(calls[0].document).toBe(ApiKeyAddRoleDocument);
    expect(calls[0].variables).toEqual({ input: { apiKeyId: "k1", role: "VIEWER" } });
  });

  it("deletes keys via the delete document", async () => {
    const { executor, calls } = recordingExecutor({ apiKey: { delete: true } });
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({ action: "delete", ids: ["k1", "k2"], ...bothFlags });

    expect(result.isError).toBeUndefined();
    expect(calls[0].document).toBe(ApiKeyDeleteDocument);
    expect(calls[0].variables).toEqual({ input: { ids: ["k1", "k2"] } });
  });

  it("maps executor failures to a clean error", async () => {
    const handler = createApiKeyManageHandler(throwingExecutor("forbidden"));

    const result = await handler({ action: "delete", ids: ["k1"], ...bothFlags });

    expect(result.isError).toBe(true);
  });
});
