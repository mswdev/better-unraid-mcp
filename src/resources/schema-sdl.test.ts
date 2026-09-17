import { describe, expect, it } from "vitest";
import { loadSchemaSdl, loadSchemaVersion } from "./schema-sdl.js";

describe("loadSchemaSdl", () => {
  it("reads the vendored SDL shipped next to the package", () => {
    expect(loadSchemaSdl()).toContain("type Query");
  });

  it("throws a clear error when no candidate path exists", () => {
    const missing = () => {
      throw new Error("ENOENT");
    };

    expect(() => loadSchemaSdl(missing)).toThrow(/schema\/unraid\.graphql not found/);
  });
});

describe("loadSchemaVersion", () => {
  it("returns the recorded upstream API version", () => {
    const reader = () => JSON.stringify({ apiVersion: "4.37.4" });

    expect(loadSchemaVersion(reader)).toBe("4.37.4");
  });

  it("returns null when the sidecar is missing", () => {
    const missing = () => {
      throw new Error("ENOENT");
    };

    expect(loadSchemaVersion(missing)).toBeNull();
  });

  it("returns null when the sidecar has no version string", () => {
    expect(loadSchemaVersion(() => "{}")).toBeNull();
    expect(loadSchemaVersion(() => "not json")).toBeNull();
  });

  it("reads the real sidecar shipped next to the schema", () => {
    expect(loadSchemaVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
