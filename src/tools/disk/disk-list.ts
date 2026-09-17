import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { DiskListDocument, type DiskListQuery } from "../../types/unraid/graphql.js";
import { humanizeBytes } from "../_shared/format-bytes.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "disk_list";

const inputSchema = z.object({
  response_format: z.enum(["concise", "detailed"]).default("concise"),
});

type Disks = DiskListQuery["disks"];
type Partition = Disks[number]["partitions"][number];

/** Partition names are `<device>` + optional `p` + digits (sda1, nvme0n1p1). */
const PARTITION_SUFFIX_PATTERN = "p?[0-9]+$";

/** Escapes regex metacharacters so a device name can be embedded in a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keeps only the partitions that really belong to `device`. The Unraid API
 * matches partitions by name prefix, so `/dev/sda` also lists `sdaa1`,
 * `sdab1`, … on servers with more than 26 disks (observed on Unraid 7.3.2 /
 * API 4.37.4).
 *
 * @param device - The disk's device path, e.g. `/dev/sda` or `/dev/nvme0n1`.
 * @param partitions - The partitions the API attached to that disk.
 * @returns The partitions whose name is the device name plus a partition number.
 * @example
 * partitionsOfDevice("/dev/sda", [{ name: "sda1" }, { name: "sdaa1" }]); // → [{ name: "sda1" }]
 */
export function partitionsOfDevice(device: string, partitions: Partition[]): Partition[] {
  const base = escapeRegExp(device.replace(/^\/dev\//, ""));
  const pattern = new RegExp(`^${base}${PARTITION_SUFFIX_PATTERN}`);
  return partitions.filter((partition) => pattern.test(partition.name));
}

/** Applies the partition filter to every disk. */
function withOwnPartitions(disks: Disks): Disks {
  return disks.map((disk) => ({
    ...disk,
    partitions: partitionsOfDevice(disk.device, disk.partitions),
  }));
}

/**
 * Summarizes each physical disk on one line. The API's interfaceType is
 * excluded here (kept in the detailed payload) because live servers have been
 * seen reporting SAS for every drive, SATA included; a missing temperature
 * usually just means the disk is spun down.
 */
function summarize(disks: Disks): string {
  if (disks.length === 0) {
    return "No physical disks detected.";
  }
  return disks
    .map((disk) => {
      const temp = disk.temperature != null ? `, ${disk.temperature}°C` : "";
      return `${disk.name} (${humanizeBytes(disk.size)}) — SMART ${disk.smartStatus}${temp}`;
    })
    .join("\n");
}

/**
 * Creates the `disk_list` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to fetch physical disks.
 * @returns An MCP tool handler listing physical disks and their health.
 */
export function createDiskListHandler(client: GraphQLExecutor) {
  return async ({
    response_format,
  }: { response_format: ResponseFormat }): Promise<CallToolResult> => {
    try {
      const data = await client.execute(DiskListDocument);
      const disks = withOwnPartitions(data.disks);
      return formatResponse(response_format, summarize(disks), disks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to fetch disks: ${message}`);
    }
  };
}

/**
 * Registers the read-only `disk_list` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerDiskList(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "List Unraid Physical Disks",
      description:
        "Read-only. Lists physical disks with model, size, interface, SMART status, temperature, and partitions.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    createDiskListHandler(client),
  );
}
