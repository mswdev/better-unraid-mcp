import { describe, expect, it } from "vitest";
import { DOCKER_UNAVAILABLE, requireService, VMS_UNAVAILABLE } from "./require-service.js";

describe("requireService", () => {
  it("returns the root unchanged when the API returned one", () => {
    const docker = { containers: [] };

    const result = requireService(docker, DOCKER_UNAVAILABLE);

    expect(result).toBe(docker);
  });

  it("throws the given unavailable message when the root is null", () => {
    expect(() => requireService(null, VMS_UNAVAILABLE)).toThrow(VMS_UNAVAILABLE);
  });
});
