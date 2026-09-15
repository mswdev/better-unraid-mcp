import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** One guided workflow: registration metadata plus the instruction text. */
interface GuidedWorkflow {
  name: string;
  title: string;
  description: string;
  text: string;
}

const TRIAGE_ARRAY_PROBLEM: GuidedWorkflow = {
  name: "triage-array-problem",
  title: "Triage an Array Problem",
  description: "Systematically diagnose an unhealthy array, worst signal first.",
  text: [
    "Triage a suspected Unraid array problem, in this order:",
    "1. Run system_health — it scores every subsystem; start from the worst.",
    "2. Run array_status (detailed) for array state, capacity, and per-disk status/temps.",
    "3. Run disk_list to check SMART status and temperatures of the physical disks.",
    "4. Run notification_alerts for unread warnings/alerts the server already raised.",
    "5. Run parity_history to see whether recent parity checks found errors.",
    "6. If a disk looks failed or disabled: do NOT take corrective action automatically.",
    "   Summarize the evidence, explain the risk, and let the owner decide next steps.",
    "Any fix (array stop, parity check) is gated — present the plan before confirming.",
  ].join("\n"),
};

const FIND_RESOURCE_HOG: GuidedWorkflow = {
  name: "find-resource-hog",
  title: "Find the Resource Hog",
  description: "Track down what is eating CPU, memory, or network.",
  text: [
    "Find what is consuming this Unraid server's resources:",
    "1. Run system_metrics — establish overall CPU, memory, and network pressure.",
    "2. Run docker_stats (needs SSH) — per-container CPU/memory/IO, hungriest first.",
    "3. If no container explains the load, run shell_exec with `ps axo pid,pcpu,pmem,comm --sort=-pcpu | head -n 15` for host processes.",
    "4. Cross-check the suspect with docker_container_logs for error loops or restarts.",
    "5. Report the culprit with numbers; suggest (but do not perform) remediation —",
    "   restarting or stopping a container is gated behind docker_container_action.",
  ].join("\n"),
};

const SAFE_CONTAINER_UPDATE: GuidedWorkflow = {
  name: "safe-container-update",
  title: "Safely Update a Container",
  description: "Update one container (or all updatable) with pre- and post-checks.",
  text: [
    "Safely update Docker container(s) — target: {{container}} (empty = ask, or all updatable):",
    "1. Run docker_container_list — confirm the target exists and an update is available.",
    "2. Note the container's current state; warn the owner it will restart during update.",
    "3. Run docker_container_update (gated: confirm) for the target id(s).",
    "4. Afterwards run docker_container_list again to confirm the container came back up.",
    "5. Run docker_container_logs on it to check the new image started cleanly.",
    "6. Report old vs new state and anything suspicious in the logs.",
  ].join("\n"),
};

const HEALTH_REPORT: GuidedWorkflow = {
  name: "health-report",
  title: "Owner Health Report",
  description: "A readable status report an owner can skim.",
  text: [
    "Produce a readable health report for this Unraid server:",
    "1. Run system_health (detailed) for the scored rollup.",
    "2. Run system_metrics for current CPU/memory/network numbers.",
    "3. Run ups_status for power protection state (skip gracefully if none).",
    "4. Run parity_history for the last parity check date and result.",
    "5. Compose a short report: an overall verdict line, a table of subsystems with",
    "   status, and a 'needs attention' list with concrete next steps. No fixes —",
    "   this is a read-only report.",
  ].join("\n"),
};

const WORKFLOWS: GuidedWorkflow[] = [
  TRIAGE_ARRAY_PROBLEM,
  FIND_RESOURCE_HOG,
  SAFE_CONTAINER_UPDATE,
  HEALTH_REPORT,
];

/** Builds the single-user-message prompt payload the MCP spec expects. */
function promptMessages(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

/**
 * Registers the guided workflow prompts. `safe-container-update` takes an
 * optional `container` argument substituted into its instructions.
 *
 * @param server - The MCP server to register prompts on.
 * @returns Nothing; registers prompts as a side effect.
 */
export function registerAllPrompts(server: McpServer): void {
  for (const workflow of WORKFLOWS) {
    if (workflow.name === "safe-container-update") {
      registerContainerUpdatePrompt(server, workflow);
      continue;
    }
    server.registerPrompt(
      workflow.name,
      { title: workflow.title, description: workflow.description },
      async () => promptMessages(workflow.text),
    );
  }
}

/** The one parameterized prompt: substitutes the container argument. */
function registerContainerUpdatePrompt(server: McpServer, workflow: GuidedWorkflow): void {
  server.registerPrompt(
    workflow.name,
    {
      title: workflow.title,
      description: workflow.description,
      argsSchema: { container: z.string().optional() },
    },
    async (args: { container?: string }) =>
      promptMessages(workflow.text.replace("{{container}}", args.container ?? "(not specified)")),
  );
}
