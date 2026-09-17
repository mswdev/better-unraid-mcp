import { describe, expect, it } from "vitest";
import type { GraphQLExecutor } from "../../graphql/client.js";
import type { DiskListQuery } from "../../types/unraid/graphql.js";
import { firstText } from "../_shared/test-support.js";
import { createDiskListHandler, partitionsOfDevice } from "./disk-list.js";

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

const diskNoTemp = {
  disks: [
    {
      device: "/dev/sdc",
      name: "Seagate ST4000",
      vendor: "Seagate",
      type: "HDD",
      size: 4_000_000_000_000,
      interfaceType: "SATA",
      smartStatus: "OK",
      temperature: null,
      isSpinning: false,
      serialNum: "XYZ789",
      firmwareRevision: "2.0",
      partitions: [],
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

  it("omits the temperature when it is null", async () => {
    const result = await createDiskListHandler(fakeExecutor(diskNoTemp))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/Seagate ST4000/);
    expect(firstText(result)).not.toMatch(/°C/);
  });
});

/** A minimal XFS partition fixture typed against the generated query. */
function partition(name: string): DiskListQuery["disks"][number]["partitions"][number] {
  return { name, fsType: "XFS", size: 1 };
}

describe("partitionsOfDevice", () => {
  it("drops partitions of other devices that share the name prefix (upstream prefix-match bug)", () => {
    const partitions = ["sda1", "sdaa1", "sdab1", "sdae1"].map((name) => partition(name));

    expect(partitionsOfDevice("/dev/sda", partitions).map((p) => p.name)).toEqual(["sda1"]);
  });

  it("keeps nvme partitions with the p separator", () => {
    const partitions = [partition("nvme0n1p1")];

    expect(partitionsOfDevice("/dev/nvme0n1", partitions)).toHaveLength(1);
  });

  it("keeps multiple partitions of the same device", () => {
    const partitions = ["sdb1", "sdb2", "sdba1"].map((name) => partition(name));

    expect(partitionsOfDevice("/dev/sdb", partitions).map((p) => p.name)).toEqual(["sdb1", "sdb2"]);
  });
});

describe("disk_list handler partition filtering", () => {
  it("returns only the disk's own partitions in detailed mode", async () => {
    const bleed = {
      disks: [
        {
          ...disks.disks[0],
          device: "/dev/sda",
          partitions: [
            { name: "sda1", fsType: "XFS", size: 1 },
            { name: "sdaa1", fsType: "XFS", size: 2 },
          ],
        },
      ],
    } satisfies DiskListQuery;

    const result = await createDiskListHandler(fakeExecutor(bleed))({
      response_format: "detailed",
    });

    const parsed = JSON.parse(firstText(result)) as Array<{ partitions: Array<{ name: string }> }>;
    expect(parsed[0].partitions.map((p) => p.name)).toEqual(["sda1"]);
  });
});
