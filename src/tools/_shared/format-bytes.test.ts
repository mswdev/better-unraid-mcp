import { describe, expect, it } from "vitest";
import { humanizeBytes, humanizeKilobytes, toNumber } from "./format-bytes.js";

describe("humanizeBytes", () => {
  it("formats zero and sub-KB as bytes", () => {
    expect(humanizeBytes(0)).toBe("0 B");
    expect(humanizeBytes(512)).toBe("512 B");
  });

  it("scales up to KB/GB with one decimal", () => {
    expect(humanizeBytes(1536)).toBe("1.5 KB");
    expect(humanizeBytes(1024 * 1024 * 1024 * 1.5)).toBe("1.5 GB");
  });

  it("rolls exactly 1024 bytes up to the next unit", () => {
    expect(humanizeBytes(1024)).toBe("1.0 KB");
  });

  it("clamps very large values at the largest unit (PB)", () => {
    expect(humanizeBytes(1024 ** 6)).toBe("1024.0 PB");
  });

  it("treats non-finite or negative input as zero", () => {
    expect(humanizeBytes(Number.NaN)).toBe("0 B");
    expect(humanizeBytes(-5)).toBe("0 B");
  });
});

describe("humanizeKilobytes", () => {
  it("converts kilobytes through the byte formatter", () => {
    expect(humanizeKilobytes(1024)).toBe("1.0 MB");
  });
});

describe("toNumber", () => {
  it("parses numeric strings and falls back to 0", () => {
    expect(toNumber("123")).toBe(123);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("not-a-number")).toBe(0);
  });
});
