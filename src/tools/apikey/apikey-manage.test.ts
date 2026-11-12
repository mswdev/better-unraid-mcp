import { describe, expect, it } from "vitest";
import {
  ApiKeyAddRoleDocument,
  ApiKeyCreateDocument,
  ApiKeyDeleteDocument,
  ApiKeyRemoveRoleDocument,
  ApiKeyUpdateDocument,
  type ApiKeyUpdateMutation,
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

  it("rejects update without an id before the gate", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({ action: "update", name: "renamed", ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('action "update" requires `id`');
    expect(calls).toHaveLength(0);
  });

  it("rejects delete without any ids before the gate", async () => {
    const { executor, calls } = recordingExecutor({});
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({ action: "delete", ids: [], ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('action "delete" requires `ids`');
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

  it("updates a key and reports its new roles", async () => {
    const updated = {
      apiKey: {
        update: { id: "k1", name: "renamed", description: null, roles: ["ADMIN", "VIEWER"] },
      },
    } satisfies ApiKeyUpdateMutation;
    const { executor, calls } = recordingExecutor(updated);
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({ action: "update", id: "k1", name: "renamed", ...bothFlags });

    expect(calls[0].document).toBe(ApiKeyUpdateDocument);
    expect(calls[0].variables).toEqual({
      input: { id: "k1", name: "renamed", description: undefined, roles: undefined },
    });
    expect(firstText(result)).toBe('Updated API key "renamed" (id k1); roles now [ADMIN, VIEWER].');
  });

  it("removes a role via the remove-role document", async () => {
    const { executor, calls } = recordingExecutor({ apiKey: { removeRole: true } });
    const handler = createApiKeyManageHandler(executor);

    const result = await handler({
      action: "remove_role",
      id: "k1",
      roles: ["ADMIN"],
      ...bothFlags,
    });

    expect(calls[0].document).toBe(ApiKeyRemoveRoleDocument);
    expect(calls[0].variables).toEqual({ input: { apiKeyId: "k1", role: "ADMIN" } });
    expect(firstText(result)).toContain("Role ADMIN removed from API key k1");
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

  it("prefixes executor failures with the tool context", async () => {
    const handler = createApiKeyManageHandler(throwingExecutor("socket hang up"));

    const result = await handler({ action: "delete", ids: ["k1"], ...bothFlags });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to delete API key(s): socket hang up");
  });
});
