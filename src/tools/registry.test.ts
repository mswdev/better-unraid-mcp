import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../graphql/client.js";
import { TOOL_REGISTRATIONS, registerAllTools } from "./registry.js";

interface Registration {
  name: string;
  hasConfig: boolean;
  hasHandler: boolean;
  annotations: unknown;
  hasOutputSchema: boolean;
}

function fakeServer() {
  const registrations: Registration[] = [];
  return {
    registrations,
    server: {
      registerTool: (
        name: string,
        config: { annotations?: unknown; outputSchema?: unknown },
        handler: unknown,
      ) => {
        registrations.push({
          name,
          hasConfig: typeof config === "object" && config !== null,
          hasHandler: typeof handler === "function",
          annotations: config?.annotations,
          hasOutputSchema: config?.outputSchema !== undefined,
        });
      },
    },
  };
}

const noopClient: GraphQLExecutor = { execute: async () => ({}) as never };

// biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
function registerAll(server: any, readOnly = false): void {
  registerAllTools(server, { client: noopClient, shell: null, readOnly });
}

describe("registerAllTools", () => {
  it("registers system_info with a config and handler", () => {
    const { server, registrations } = fakeServer();

    registerAll(server);

    const info = registrations.find((registration) => registration.name === "system_info");
    expect(info).toBeDefined();
    expect(info?.hasConfig).toBe(true);
    expect(info?.hasHandler).toBe(true);
  });

  it("registers vm_list as read-only", () => {
    const { server, registrations } = fakeServer();

    registerAll(server);

    const list = registrations.find((registration) => registration.name === "vm_list");
    expect(list?.hasHandler).toBe(true);
    expect(list?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("registers vm_action as destructive", () => {
    const { server, registrations } = fakeServer();

    registerAll(server);

    const action = registrations.find((registration) => registration.name === "vm_action");
    expect(action?.hasHandler).toBe(true);
    expect(action?.annotations).toMatchObject({ destructiveHint: true });
  });

  it("registers array_action as destructive and not read-only", () => {
    const { server, registrations } = fakeServer();

    registerAll(server);

    const action = registrations.find((registration) => registration.name === "array_action");
    expect(action?.hasHandler).toBe(true);
    expect(action?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it("registers parity_check as destructive and not read-only", () => {
    const { server, registrations } = fakeServer();

    registerAll(server);

    const check = registrations.find((registration) => registration.name === "parity_check");
    expect(check?.hasHandler).toBe(true);
    expect(check?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
  });

  it("registers the three notification reads as read-only", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    for (const name of ["notification_overview", "notification_list", "notification_alerts"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("registers notification_archive/create/recalculate as ungated non-destructive writes", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    for (const name of [
      "notification_archive",
      "notification_create",
      "notification_recalculate",
    ]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it("registers notification_delete as destructive", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    const reg = registrations.find((r) => r.name === "notification_delete");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({ destructiveHint: true });
  });

  it("registers plugin_list as read-only", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    const reg = registrations.find((r) => r.name === "plugin_list");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it("registers plugin_add/plugin_remove as destructive", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    for (const name of ["plugin_add", "plugin_remove"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
  });

  it("registers the observability reads as read-only", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    for (const name of ["log_list", "log_read", "system_metrics"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
  });

  it("registers ups_status as read-only", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    const reg = registrations.find((r) => r.name === "ups_status");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });
});

describe("registerAllTools host-level tools", () => {
  it("registers mover_status as read-only", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    const reg = registrations.find((r) => r.name === "mover_status");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it("registers docker_stats and file_read as read-only even without SSH", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    for (const name of ["docker_stats", "file_read"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("registers shell_exec as destructive and open-world", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    const reg = registrations.find((r) => r.name === "shell_exec");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });

  it("registers 50 tools in total", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    expect(registrations).toHaveLength(50);
  });
});

describe("registerAllTools raw GraphQL tools", () => {
  it("registers graphql_query as read-only and graphql_mutation as destructive", () => {
    const { server, registrations } = fakeServer();
    registerAll(server);
    const query = registrations.find((r) => r.name === "graphql_query");
    expect(query?.hasHandler).toBe(true);
    expect(query?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const mutation = registrations.find((r) => r.name === "graphql_mutation");
    expect(mutation?.hasHandler).toBe(true);
    expect(mutation?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("registerAllTools mover_action", () => {
  it("registers mover_action as destructive", () => {
    const { server, registrations } = fakeServer();

    registerAll(server);

    const reg = registrations.find((r) => r.name === "mover_action");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("registerAllTools system_power", () => {
  it("registers system_power as destructive", () => {
    const { server, registrations } = fakeServer();

    registerAll(server);

    const reg = registrations.find((r) => r.name === "system_power");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("read-only mode", () => {
  it("registers only read-only tools when readOnly is true", () => {
    const { server, registrations } = fakeServer();

    registerAll(server, true);

    expect(registrations).toHaveLength(28);
    for (const registration of registrations) {
      expect(registration.annotations).toMatchObject({ readOnlyHint: true });
    }
  });

  it("isMutating mirrors readOnlyHint for every entry", () => {
    for (const entry of TOOL_REGISTRATIONS) {
      const { server, registrations } = fakeServer();

      // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
      entry.register(server as any, { client: noopClient, shell: null, readOnly: false });

      expect(registrations).toHaveLength(1);
      const annotations = registrations[0].annotations as { readOnlyHint?: boolean };
      expect(entry.isMutating).toBe(annotations.readOnlyHint !== true);
    }
  });
});

describe("annotation audit", () => {
  it("every tool declares the full annotation set", () => {
    for (const entry of TOOL_REGISTRATIONS) {
      const { server, registrations } = fakeServer();

      // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
      entry.register(server as any, { client: noopClient, shell: null, readOnly: false });

      const annotations = registrations[0].annotations as Record<string, unknown>;
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        expect(typeof annotations[hint], `${registrations[0].name} is missing ${hint}`).toBe(
          "boolean",
        );
      }
    }
  });
});

describe("structured output tools", () => {
  it("the four structured reads declare an outputSchema", () => {
    const { server, registrations } = fakeServer();

    registerAll(server);

    for (const name of [
      "system_health",
      "system_metrics",
      "array_status",
      "docker_container_list",
    ]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasOutputSchema, `${name} should declare outputSchema`).toBe(true);
    }
  });
});
