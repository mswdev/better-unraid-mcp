import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../graphql/client.js";
import { registerAllTools } from "./registry.js";

interface Registration {
  name: string;
  hasConfig: boolean;
  hasHandler: boolean;
  annotations: unknown;
}

function fakeServer() {
  const registrations: Registration[] = [];
  return {
    registrations,
    server: {
      registerTool: (name: string, config: { annotations?: unknown }, handler: unknown) => {
        registrations.push({
          name,
          hasConfig: typeof config === "object" && config !== null,
          hasHandler: typeof handler === "function",
          annotations: config?.annotations,
        });
      },
    },
  };
}

const noopClient: GraphQLExecutor = { execute: async () => ({}) as never };

describe("registerAllTools", () => {
  it("registers system_info with a config and handler", () => {
    const { server, registrations } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    const info = registrations.find((registration) => registration.name === "system_info");
    expect(info).toBeDefined();
    expect(info?.hasConfig).toBe(true);
    expect(info?.hasHandler).toBe(true);
  });

  it("registers vm_list as read-only", () => {
    const { server, registrations } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    const list = registrations.find((registration) => registration.name === "vm_list");
    expect(list?.hasHandler).toBe(true);
    expect(list?.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("registers vm_action as destructive", () => {
    const { server, registrations } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

    const action = registrations.find((registration) => registration.name === "vm_action");
    expect(action?.hasHandler).toBe(true);
    expect(action?.annotations).toMatchObject({ destructiveHint: true });
  });

  it("registers array_action as destructive and not read-only", () => {
    const { server, registrations } = fakeServer();

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

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

    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);

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
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
    for (const name of ["notification_overview", "notification_list", "notification_alerts"]) {
      const reg = registrations.find((r) => r.name === name);
      expect(reg?.hasHandler).toBe(true);
      expect(reg?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });

  it("registers notification_archive/create/recalculate as ungated non-destructive writes", () => {
    const { server, registrations } = fakeServer();
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
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
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
    const reg = registrations.find((r) => r.name === "notification_delete");
    expect(reg?.hasHandler).toBe(true);
    expect(reg?.annotations).toMatchObject({ destructiveHint: true });
  });

  it("registers the observability reads as read-only", () => {
    const { server, registrations } = fakeServer();
    // biome-ignore lint/suspicious/noExplicitAny: minimal structural fake for registration.
    registerAllTools(server as any, noopClient);
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
});
