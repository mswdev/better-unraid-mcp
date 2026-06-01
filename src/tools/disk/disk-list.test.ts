import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DiskListQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createDiskListHandler } from "./disk-list.js";

const disks = {
  disks: [
    {
      device: "/dev/sdb",
      name: "WDC WD80EFAX",
      vendor: "WDC",
      type: "HDD",
      size: 8_000_000_000_000,
      interfaceType: "SATA",
      smartStatus: "OK",
      temperature: 34,
      isSpinning: true,
      serialNum: "ABC123",
      firmwareRevision: "1.0",
      partitions: [{ name: "sdb1", fsType: "XFS", size: 8_000_000_000_000 }],
    },
  ],
} satisfies DiskListQuery;

function fakeExecutor(result: DiskListQuery): GraphQLExecutor {
  return { execute: async () => result as never };
}

describe("disk_list handler", () => {
  it("summarizes each disk with size, interface, SMART and temp", async () => {
    const result = await createDiskListHandler(fakeExecutor(disks))({ response_format: "concise" });

    expect(firstText(result)).toMatch(/WDC WD80EFAX/);
    expect(firstText(result)).toMatch(/7\.3 TB/);
    expect(firstText(result)).toMatch(/SMART OK/);
    expect(firstText(result)).toMatch(/34°C/);
  });

  it("handles no disks", async () => {
    const result = await createDiskListHandler(fakeExecutor({ disks: [] }))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/No physical disks/);
  });
});
