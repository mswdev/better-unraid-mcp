import { describe, expect, it } from "vitest";
import { firstText, sequencedShell } from "../_shared/test-support.js";
import { parentDiskOf, parseAssignedDevices, selectUnassigned } from "./_shared.js";
import { createUnassignedListHandler } from "./unassigned-list.js";

const DISKS_INI = `["parity"]
name="parity"
device="sdw"
["disk1"]
device="sdf"
["cache"]
device="nvme0n1"
["flash"]
device="sdae"
`;

const LSBLK = JSON.stringify({
  blockdevices: [
    {
      name: "loop0",
      kname: "loop0",
      type: "loop",
      size: "736M",
      fstype: "squashfs",
      mountpoint: "/usr",
      label: null,
      model: null,
      serial: null,
      tran: null,
    },
    {
      name: "sdf",
      kname: "sdf",
      type: "disk",
      size: "9.1T",
      fstype: null,
      mountpoint: null,
      label: null,
      model: "ST10000",
      serial: "ZS5",
      tran: "sas",
      children: [
        {
          name: "sdf1",
          kname: "sdf1",
          type: "part",
          size: "9.1T",
          fstype: "xfs",
          mountpoint: "/mnt/disk1",
          label: null,
          model: null,
          serial: null,
          tran: null,
        },
      ],
    },
    {
      name: "sdz",
      kname: "sdz",
      type: "disk",
      size: "1.8T",
      fstype: null,
      mountpoint: null,
      label: null,
      model: "WDC WD20",
      serial: "WD-123",
      tran: "usb",
      children: [
        {
          name: "sdz1",
          kname: "sdz1",
          type: "part",
          size: "1.8T",
          fstype: "ntfs",
          mountpoint: null,
          label: "Backup",
          model: null,
          serial: null,
          tran: null,
        },
      ],
    },
    {
      name: "nvme0n1",
      kname: "nvme0n1",
      type: "disk",
      size: "1.8T",
      fstype: null,
      mountpoint: null,
      label: null,
      model: "Samsung",
      serial: "S6",
      tran: "nvme",
      children: [],
    },
  ],
});

describe("unassigned _shared", () => {
  it("collects every assigned device name from disks.ini", () => {
    expect([...parseAssignedDevices(DISKS_INI)].sort()).toEqual(["nvme0n1", "sdae", "sdf", "sdw"]);
  });

  it("keeps only whole disks that are not array, pool, or flash members", () => {
    const disks = selectUnassigned(LSBLK, parseAssignedDevices(DISKS_INI));

    expect(disks).toHaveLength(1);
    expect(disks[0]).toMatchObject({ device: "/dev/sdz", model: "WDC WD20", transport: "usb" });
    expect(disks[0].partitions[0]).toMatchObject({
      device: "/dev/sdz1",
      fstype: "ntfs",
      label: "Backup",
      mountpoint: null,
    });
  });

  it("drops zram, loop, ram, and device-mapper pseudo-disks even though lsblk types them as disk", () => {
    const pseudo = JSON.stringify({
      blockdevices: [
        {
          name: "zram0",
          kname: "zram0",
          type: "disk",
          size: "0B",
          fstype: null,
          mountpoint: null,
          label: null,
          model: null,
          serial: null,
          tran: null,
        },
        {
          name: "ram0",
          kname: "ram0",
          type: "disk",
          size: "8M",
          fstype: null,
          mountpoint: null,
          label: null,
          model: null,
          serial: null,
          tran: null,
        },
        {
          name: "dm-0",
          kname: "dm-0",
          type: "disk",
          size: "1G",
          fstype: null,
          mountpoint: null,
          label: null,
          model: null,
          serial: null,
          tran: null,
        },
      ],
    });

    expect(selectUnassigned(pseudo, new Set())).toEqual([]);
  });

  it("returns an empty list for unparsable lsblk output", () => {
    expect(selectUnassigned("garbage", new Set())).toEqual([]);
  });
});

describe("unassigned_list", () => {
  it("lists unassigned disks with their partitions and mount state", async () => {
    const { shell, calls } = sequencedShell([
      { stdout: DISKS_INI, stderr: "", exitCode: 0 },
      { stdout: LSBLK, stderr: "", exitCode: 0 },
    ]);
    const handler = createUnassignedListHandler(shell);

    const result = await handler({ response_format: "concise" });
    const text = firstText(result);

    expect(calls[0].command).toBe("cat '/var/local/emhttp/disks.ini'");
    expect(calls[1].command).toContain("lsblk -J");
    expect(text).toContain("/dev/sdz");
    expect(text).toContain("/dev/sdz1");
    expect(text).toContain("not mounted");
    expect(text).not.toContain("/dev/sdf");
  });

  it("says so when every disk is assigned", async () => {
    const { shell } = sequencedShell([
      { stdout: DISKS_INI, stderr: "", exitCode: 0 },
      { stdout: JSON.stringify({ blockdevices: [] }), stderr: "", exitCode: 0 },
    ]);
    const handler = createUnassignedListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toContain("No unassigned disks");
  });

  it("reports SSH unavailable without a shell", async () => {
    const result = await createUnassignedListHandler(null)({ response_format: "concise" });

    expect(result.isError).toBe(true);
  });
});

/** A bare lsblk listing: one sparse disk with a sparse mounted partition, one with no partitions. */
const SPARSE_LSBLK = JSON.stringify({
  blockdevices: [
    { kname: "sdq", type: "disk", children: [{ type: "part", mountpoint: "/mnt/disks/x" }] },
    { kname: "sdr", type: "disk", size: "4T", model: "ST4000", tran: "sata" },
  ],
});

describe("unassigned _shared sparse lsblk output", () => {
  it("fills placeholders for every field lsblk left out", () => {
    const disks = selectUnassigned(SPARSE_LSBLK, new Set());

    expect(disks[0]).toEqual({
      device: "/dev/sdq",
      model: null,
      serial: null,
      size: "?",
      transport: null,
      partitions: [
        { device: "/dev/?", fstype: null, mountpoint: "/mnt/disks/x", label: null, size: "?" },
      ],
    });
  });

  it("returns an empty list when the JSON has no blockdevices array", () => {
    expect(selectUnassigned('{"blockdevices":"none"}', new Set())).toEqual([]);
  });

  it("maps partitions back to their parent disk for both naming schemes", () => {
    expect(parentDiskOf("/dev/sdz1")).toBe("sdz");
    expect(parentDiskOf("/dev/nvme0n1p1")).toBe("nvme0n1");
  });
});

describe("unassigned_list rendering and failures", () => {
  it("renders unknown identity, missing filesystem, mount state, and partition-less disks", async () => {
    const { shell } = sequencedShell([
      { stdout: "", stderr: "", exitCode: 0 },
      { stdout: SPARSE_LSBLK, stderr: "", exitCode: 0 },
    ]);
    const handler = createUnassignedListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe(
      [
        "2 unassigned disk(s):",
        "/dev/sdq — unknown model, ?",
        "  - /dev/?: no filesystem, ?, mounted at /mnt/disks/x",
        "/dev/sdr — ST4000, 4T (sata)",
        "  (no partitions)",
      ].join("\n"),
    );
  });

  it("maps an SSH failure to a clean error", async () => {
    const { shell } = sequencedShell([new Error("connection refused")]);
    const handler = createUnassignedListHandler(shell);

    const result = await handler({ response_format: "concise" });

    expect(firstText(result)).toBe(
      "Failed to list unassigned devices over SSH: connection refused",
    );
  });
});
