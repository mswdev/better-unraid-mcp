# Array & Parity Control Tools Implementation Plan (PR #7)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or the established Workflow build with one subagent per task) to implement this plan task-by-task.

**Goal:** Ship `array_action` (start/stop the array via `Mutation.array.setState`) and `parity_check` (start/pause/resume/cancel via `Mutation.parityCheck.*`), plus the `array_status` parity-clause fix, per the reconciled design at `docs/plans/2026-06-06-array-parity-tools-design.md`.

**Architecture:** Two 1-call tools (gate → mutation → report-action-and-point). The mutation responses cannot prove results (setState returns the pre-mutation store snapshot; the parity `JSON!` is a stale history array — validated against unraid/api @ 264ddf0 / v4.35.0), so success copy always says "requested" and points to `array_status`. Known API guard/read-back messages map to honest non-generic results. Everything else follows existing conventions: `GraphQLExecutor` seam, per-tool `.graphql` docs, codegen single committed file, `_shared` helpers, hermetic tests with `satisfies` fixtures.

**Tech Stack:** TypeScript (NodeNext, `.js` imports), MCP SDK v1.29, zod, graphql-codegen (`enumsAsTypes` — SDL enums are string-literal unions), vitest, Biome.

**Branch:** `feature/array-tools` (already cut from `develop`; design docs committed).

**Read first:** `docs/plans/2026-06-06-array-parity-tools-design.md` (the contract this plan implements), `src/tools/vm/vm-action.ts` (gate/dispatch precedent), `src/tools/_shared/{confirm,respond,test-support}.ts`.

**Hard rules:** methods ≤25 lines, ≤2 nesting levels, ≤3 params (use a param object), no `any`, no magic numbers, JSDoc on all exports, early returns. Quality gates before every commit: `npm run typecheck && npm run build && npm test && npm run lint`.

---

### Task 1: GraphQL operations + codegen regen (keep the build green)

**Files:**
- Create: `src/tools/array/array-action.graphql`
- Create: `src/tools/array/parity-check.graphql`
- Modify: `src/tools/array/array-status.graphql` (add `speed`)
- Modify: `src/tools/array/array-status.test.ts` (fixture compatibility only)
- Regenerate: `src/types/unraid/graphql.ts` (NEVER hand-edit — `npm run generate`)

**Step 1: Create `src/tools/array/array-action.graphql`**

```graphql
mutation ArraySetState($input: ArrayStateInput!) {
  array {
    setState(input: $input) {
      id
      state
    }
  }
}
```

Minimal selection on purpose: the returned `state` is the PRE-mutation store snapshot (design finding 1) and is only echoed as `preMutationState` in detailed output.

**Step 2: Create `src/tools/array/parity-check.graphql`**

```graphql
mutation ParityCheckStart($correct: Boolean!) {
  parityCheck {
    start(correct: $correct)
  }
}

mutation ParityCheckPause {
  parityCheck {
    pause
  }
}

mutation ParityCheckResume {
  parityCheck {
    resume
  }
}

mutation ParityCheckCancel {
  parityCheck {
    cancel
  }
}
```

**Step 3: Add `speed` to `src/tools/array/array-status.graphql`**

In the `parityCheckStatus` block, after `paused`:

```graphql
    parityCheckStatus {
      status
      progress
      errors
      running
      paused
      speed
    }
```

**Step 4: Regenerate types**

Run: `npm run generate`
Expected: `src/types/unraid/graphql.ts` gains `ArraySetStateMutation`/`ArraySetStateDocument` (+ `ArrayStateInput`, `ArrayStateInputState = 'START' | 'STOP'`), the four `ParityCheck*Mutation`/`ParityCheck*Document` pairs, and `speed: string | null` on `ArrayStatusQuery`'s `parityCheckStatus`. Verify with:
`grep -n "ArraySetStateDocument\|ParityCheckStartDocument\|ArrayStateInputState" src/types/unraid/graphql.ts`

**Step 5: Patch the two `array-status.test.ts` fixtures for the new required field**

The `satisfies ArrayStatusQuery` fixtures now fail typecheck (missing `speed`). In the `started` fixture's `parityCheckStatus` add `speed: "0"`; in the `stopped` fixture's add `speed: null`. No assertion changes in this task.

**Step 6: Verify green + commit**

Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all pass (no behavior changed yet).

```bash
git add src/tools/array/array-action.graphql src/tools/array/parity-check.graphql src/tools/array/array-status.graphql src/tools/array/array-status.test.ts src/types/unraid/graphql.ts
git commit -m "feat(array): add setState/parityCheck operations + regenerate types"
```

---

### Task 2: `array_status` parity-clause fix (TDD)

`errors`/`running`/`paused` are never populated by this resolver at v4.35.0 (validated) — the shipped summary asserts a misleading "0 errors". Replace the parity clause: active checks show progress + speed; otherwise defer error counts to `parity_history`.

**Files:**
- Modify: `src/tools/array/array-status.ts`
- Modify: `src/tools/array/array-status.test.ts`

**Step 1: Update/extend the tests**

In `array-status.test.ts`:

(a) Add a `running` fixture after `stopped` (copy `started`, change only `parityCheckStatus`):

```typescript
const checking = {
  array: {
    ...started.array,
    parityCheckStatus: {
      status: "RUNNING",
      progress: 37,
      errors: null,
      running: null,
      paused: null,
      speed: "98",
    },
  },
} satisfies ArrayStatusQuery;
```

(b) Add two tests at the end of the describe block:

```typescript
  it("shows progress and speed while a check is active", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(checking))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/Parity check RUNNING: 37% at 98 MB\/s/);
  });

  it("defers error counts to parity_history instead of asserting 0 errors", async () => {
    const result = await createArrayStatusHandler(fakeExecutor(started))({
      response_format: "concise",
    });

    expect(firstText(result)).toMatch(/Parity: COMPLETED \(errors: see parity_history\)/);
    expect(firstText(result)).not.toMatch(/0 errors/);
  });
```

(c) In the existing `"handles a stopped array..."` test, replace the `expect(firstText(result)).toMatch(/0 errors/);` line with:

```typescript
    expect(firstText(result)).toMatch(/Parity: NEVER_RUN/);
```

**Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/tools/array/array-status.test.ts`
Expected: the two new tests FAIL (summary still says "Parity: COMPLETED, 0 errors"); the modified one FAILS.

**Step 3: Implement in `array-status.ts`**

Add below `DISK_OK`:

```typescript
/** Parity statuses that indicate a check is actively in progress. */
const ACTIVE_CHECK_STATUSES: ReadonlySet<string> = new Set(["RUNNING", "PAUSED"]);

/**
 * Describes the parity clause of the summary. The API never populates
 * `errors` on this resolver (validated at unraid/api v4.35.0), so error
 * counts are deferred to `parity_history` instead of asserting "0 errors".
 *
 * @param parity - The `parityCheckStatus` selection from the array read.
 * @returns The parity clause (no trailing period).
 */
function describeParity(parity: ArrayStatusQuery["array"]["parityCheckStatus"]): string {
  if (ACTIVE_CHECK_STATUSES.has(parity.status)) {
    return `Parity check ${parity.status}: ${parity.progress ?? 0}% at ${parity.speed ?? "?"} MB/s`;
  }
  return `Parity: ${parity.status} (errors: see parity_history)`;
}
```

In `summarize`, replace the `Parity: ${parity.status}, ${parity.errors ?? 0} errors.` segment of the template literal with `${describeParity(parity)}.` (keep the `const parity = array.parityCheckStatus;` binding).

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/array/array-status.test.ts`
Expected: PASS (all).

**Step 5: Quality gates + commit**

Run: `npm run typecheck && npm run build && npm test && npm run lint`

```bash
git add src/tools/array/array-status.ts src/tools/array/array-status.test.ts
git commit -m "fix(array): array_status parity clause — progress/speed when active, no misleading 0-errors"
```

---

### Task 3: `array_action` — enum map, gates, happy path, registration (TDD)

Registration lives in this task so every symbol (`TOOL_NAME`, `inputSchema`, the `McpServer` import) is consumed at the commit — a deferred register step would fail lint on unused symbols.

**Files:**
- Create: `src/tools/array/array-action.test.ts`
- Create: `src/tools/array/array-action.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/registry.test.ts`

**Step 1: Write the failing tests**

Create `src/tools/array/array-action.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ArraySetStateDocument, type ArraySetStateMutation } from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { DESIRED_STATE, createArrayActionHandler } from "./array-action.js";

/** Pre-mutation snapshot: a start issued against a stopped array (finding 1). */
const setStateResult = {
  array: { setState: { id: "array", state: "STOPPED" } },
} satisfies ArraySetStateMutation;

describe("DESIRED_STATE", () => {
  it("maps lowercase tool actions to SDL enum values", () => {
    expect(DESIRED_STATE.start).toBe("START");
    expect(DESIRED_STATE.stop).toBe("STOP");
  });
});

describe("array_action gate", () => {
  it("refuses start without confirm and makes no GraphQL calls", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/);
    expect(firstText(result)).toMatch(/No changes were made/);
    expect(calls).toHaveLength(0);
  });

  it("refuses stop with confirm alone, naming both flags, with no calls", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/acknowledge_risk/);
    expect(firstText(result)).toMatch(/share.*Docker container.*VM/);
    expect(calls).toHaveLength(0);
  });

  it("refuses stop with acknowledge_risk alone", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      acknowledge_risk: true,
    });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("array_action happy path", () => {
  it("dispatches START and reports the action as requested, pointing to array_status", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Array start requested/);
    expect(firstText(result)).toMatch(/array_status/);
    expect(firstText(result)).not.toMatch(/Started/);
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(ArraySetStateDocument);
    expect(calls[0].variables).toEqual({ input: { desiredState: "START" } });
  });

  it("dispatches STOP behind the two-tier gate and names the blast radius", async () => {
    const { executor, calls } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Array stop requested/);
    expect(firstText(result)).toMatch(/offline/);
    expect(calls[0].variables).toEqual({ input: { desiredState: "STOP" } });
  });

  it("labels the echoed state preMutationState in detailed output", async () => {
    const { executor } = recordingExecutor(setStateResult);

    const result = await createArrayActionHandler(executor)({
      response_format: "detailed",
      action: "start",
      confirm: true,
    });

    expect(firstText(result)).toContain('"preMutationState": "STOPPED"');
    expect(firstText(result)).toContain('"outcome": "requested"');
  });
});
```

Also append the failing registry assertion to `src/tools/registry.test.ts`'s describe block:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/array/array-action.test.ts src/tools/registry.test.ts`
Expected: FAIL — `./array-action.js` does not exist; the registry assertion fails (`array_action` not registered).

**Step 3: Implement `src/tools/array/array-action.ts` (no error mapping yet — that is Task 4)**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import { ArraySetStateDocument, type ArrayStateInputState } from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "array_action";

type ArrayAction = "start" | "stop";

/** Lowercase tool action → SDL `ArrayStateInputState` value. */
export const DESIRED_STATE: Record<ArrayAction, ArrayStateInputState> = {
  start: "START",
  stop: "STOP",
};

/**
 * Success copy per action — "requested", never "done": setState returns the
 * pre-mutation store snapshot (validated at unraid/api v4.35.0), so the
 * resulting state cannot be reported from this call.
 */
const REQUESTED_SUMMARY: Record<ArrayAction, string> = {
  start: "Array start requested. Run array_status to confirm — state reads may lag a few seconds.",
  stop: "Array stop requested — Unraid is taking every share, Docker container, and VM offline. Run array_status to confirm — state reads may lag a few seconds.",
};

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  action: z.enum(["start", "stop"]),
  confirm: z.boolean().optional(),
  acknowledge_risk: z.boolean().optional(),
};

/** The validated handler arguments. */
interface ArrayActionArgs {
  response_format: ResponseFormat;
  action: ArrayAction;
  confirm?: boolean;
  acknowledge_risk?: boolean;
}

/**
 * Two-tier gate. `stop` needs both `confirm` and `acknowledge_risk` (one
 * combined refusal naming both — the risk axis is blast radius, not
 * corruption); `start` uses the shared `requireConfirmation`.
 *
 * @param args - The action and both gate flags.
 * @returns `null` when gated through, otherwise an error `CallToolResult`.
 */
function gateRefusal(args: ArrayActionArgs): CallToolResult | null {
  const { action, confirm, acknowledge_risk } = args;
  if (action !== "stop") {
    return requireConfirmation(confirm, `${action} the array`);
  }
  if (confirm === true && acknowledge_risk === true) {
    return null;
  }
  return toolError(
    'Refusing to stop the array: Unraid will take every share, Docker container, and VM offline until the array is started again. Re-call with "confirm": true and "acknowledge_risk": true to proceed. No changes were made.',
  );
}

/**
 * Creates the `array_action` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the setState mutation.
 * @returns An MCP handler that starts/stops the array behind the gate.
 */
export function createArrayActionHandler(client: GraphQLExecutor) {
  return async (args: ArrayActionArgs): Promise<CallToolResult> => {
    const { response_format, action } = args;
    const refusal = gateRefusal(args);
    if (refusal) {
      return refusal;
    }
    try {
      const data = await client.execute(ArraySetStateDocument, {
        input: { desiredState: DESIRED_STATE[action] },
      });
      const detailed = {
        requested: action,
        outcome: "requested",
        // Pre-mutation snapshot, NOT the result (no store reload upstream).
        preMutationState: data.array.setState.state,
      };
      return formatResponse(response_format, REQUESTED_SUMMARY[action], detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${action} the array: ${message}`);
    }
  };
}

/**
 * Registers the destructive `array_action` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerArrayAction(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Start or Stop the Unraid Array",
      description:
        "Starts or stops the array. ⚠ stop: Unraid takes every share, Docker container, and VM offline (the API does not check for active services first). Requires `confirm: true`; stop additionally requires `acknowledge_risk: true`. The mutation cannot report the resulting state — run array_status afterward to confirm (state reads may lag a few seconds). Requires an Unraid API key with ADMIN role. Encrypted arrays cannot be started by this tool (no decryption inputs) — use the web UI.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createArrayActionHandler(client),
  );
}
```

Wire the registry: in `src/tools/registry.ts`, add `import { registerArrayAction } from "./array/array-action.js";` (alphabetical with the other array imports) and call `registerArrayAction(server, client);` directly after `registerArrayStatus(server, client);`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/array/array-action.test.ts src/tools/registry.test.ts`
Expected: PASS (all).

**Step 5: Quality gates + commit**

Run: `npm run typecheck && npm run build && npm test && npm run lint`

```bash
git add src/tools/array/array-action.ts src/tools/array/array-action.test.ts src/tools/registry.ts src/tools/registry.test.ts
git commit -m "feat(array): add array_action tool — two-tier stop gate + setState dispatch"
```

---

### Task 4: `array_action` error mapping (TDD)

Map the v4.35.0 guard/read-back messages (best-effort — production masking falls through to the generic failure path): same-state → benign no-op; in-flight → transient failure; state-not-loaded → command already fired, report unverified.

**Files:**
- Modify: `src/tools/array/array-action.ts`
- Modify: `src/tools/array/array-action.test.ts`

**Step 1: Add the failing tests**

Append to `array-action.test.ts` (add `throwingExecutor, rejectingExecutor` to the `test-support.js` import):

```typescript
describe("array_action error mapping", () => {
  it("maps start-when-already-STARTED to a benign no-op, not an error", async () => {
    const executor = throwingExecutor("The array is already STARTED");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/already STARTED/);
    expect(firstText(result)).toMatch(/no action was taken/);
  });

  it("hedges stop-when-already-STOPPED: error states produce the same message", async () => {
    const executor = throwingExecutor("The array is already STOPPED");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/already stopped/);
    expect(firstText(result)).toMatch(/error state/);
    expect(firstText(result)).toMatch(/array_status/);
  });

  it("does NOT map the other action's same-state message (start vs already STOPPED)", async () => {
    const executor = throwingExecutor("The array is already STOPPED");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to start the array/);
  });

  it("maps the in-flight guard to a transient retry error", async () => {
    const executor = throwingExecutor(
      "Array state is still being updated. Changing to STARTED",
    );

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "stop",
      confirm: true,
      acknowledge_risk: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/still in progress/);
    expect(firstText(result)).toMatch(/Retry shortly/);
  });

  it("reports state-not-loaded as issued-but-unverified, not failure", async () => {
    const executor = throwingExecutor("Attempt to get Array Data, but state was not loaded");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/command was issued/);
    expect(firstText(result)).toMatch(/array_status/);
  });

  it("exposes the outcome in detailed format for mapped no-ops", async () => {
    const executor = throwingExecutor("The array is already STARTED");

    const result = await createArrayActionHandler(executor)({
      response_format: "detailed",
      action: "start",
      confirm: true,
    });

    expect(firstText(result)).toContain('"outcome": "already-in-state"');
  });

  it("wraps unknown errors in the standard failure form", async () => {
    const executor = throwingExecutor("Forbidden resource");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to start the array: Forbidden resource");
  });

  it("coerces non-Error rejections to strings", async () => {
    const executor = rejectingExecutor("denied");

    const result = await createArrayActionHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to start the array: denied");
  });
});
```

**Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/tools/array/array-action.test.ts`
Expected: the mapped-message tests FAIL (everything currently lands in the generic failure path); the last two PASS already.

**Step 3: Implement the mapping in `array-action.ts`**

Add the constants below `REQUESTED_SUMMARY`:

```typescript
/**
 * The API's same-state guard message per action (validated at v4.35.0).
 * Matching is best-effort: production error masking may rewrite messages, in
 * which case the generic failure path runs instead.
 */
const ALREADY_IN_STATE_MESSAGE: Record<ArrayAction, string> = {
  start: "The array is already STARTED",
  stop: "The array is already STOPPED",
};

/** The API's re-entrancy guard: another state change is still in flight. */
const CHANGE_IN_FLIGHT_MESSAGE = "Array state is still being updated";

/** Thrown by the post-command read-back AFTER setState already fired. */
const STATE_NOT_LOADED_MESSAGE = "state was not loaded";

/**
 * Benign no-op copy per action. The stop copy hedges: the API reports error
 * states (e.g. TOO_MANY_MISSING_DISKS) with the same "already STOPPED"
 * message, so it cannot be taken literally.
 */
const NO_OP_SUMMARY: Record<ArrayAction, string> = {
  start: "Unraid reports the array is already STARTED — no action was taken.",
  stop: "Unraid reports the array is already stopped — or it is in an error state where stop does not apply (the API reports both the same way). Run array_status to see the actual state. No changes were made.",
};
```

Add the mapper above `createArrayActionHandler`:

```typescript
/** Inputs for mapping a thrown message to a known, non-generic result. */
interface KnownErrorInput {
  action: ArrayAction;
  message: string;
  format: ResponseFormat;
}

/**
 * Maps the API's known guard/read-back messages to honest results: same-state
 * → benign no-op; in-flight → transient failure; state-not-loaded → the
 * command already fired, so report it as issued-but-unverified rather than a
 * failure. Returns `null` for unknown messages (generic failure path).
 *
 * @param input - The action, the thrown message, and the response format.
 * @returns A mapped `CallToolResult`, or `null` when the message is unknown.
 */
function mapKnownError(input: KnownErrorInput): CallToolResult | null {
  const { action, message, format } = input;
  if (message.includes(ALREADY_IN_STATE_MESSAGE[action])) {
    const detailed = { requested: action, outcome: "already-in-state", apiMessage: message };
    return formatResponse(format, NO_OP_SUMMARY[action], detailed);
  }
  if (message.includes(CHANGE_IN_FLIGHT_MESSAGE)) {
    return toolError(
      `Cannot ${action} the array: another array state change is still in progress. Retry shortly. No changes were made.`,
    );
  }
  if (message.includes(STATE_NOT_LOADED_MESSAGE)) {
    const summary = `The array ${action} command was issued, but the API could not read back the array state. Run array_status to check the result.`;
    const detailed = { requested: action, outcome: "issued-unverified", apiMessage: message };
    return formatResponse(format, summary, detailed);
  }
  return null;
}
```

Replace the catch block's body in `createArrayActionHandler` with:

```typescript
      const message = error instanceof Error ? error.message : String(error);
      return (
        mapKnownError({ action, message, format: response_format }) ??
        toolError(`Failed to ${action} the array: ${message}`)
      );
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/array/array-action.test.ts`
Expected: PASS (all).

**Step 5: Quality gates + commit**

Run: `npm run typecheck && npm run build && npm test && npm run lint`

```bash
git add src/tools/array/array-action.ts src/tools/array/array-action.test.ts
git commit -m "feat(array): map setState guard/read-back errors to honest no-op/transient/unverified results"
```

---

### Task 5: `parity_check` — validation, gate, dispatch, happy path, registration (TDD)

Registration lives in this task for the same reason as Task 3 (no unused symbols at the commit).

**Files:**
- Create: `src/tools/array/parity-check.test.ts`
- Create: `src/tools/array/parity-check.ts`
- Modify: `src/tools/registry.ts`
- Modify: `src/tools/registry.test.ts`

**Step 1: Write the failing tests**

Create `src/tools/array/parity-check.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  ParityCheckCancelDocument,
  type ParityCheckCancelMutation,
  ParityCheckPauseDocument,
  type ParityCheckPauseMutation,
  ParityCheckResumeDocument,
  type ParityCheckResumeMutation,
  ParityCheckStartDocument,
  type ParityCheckStartMutation,
} from "../../types/unraid/graphql.js";
import { firstText, recordingExecutor } from "../_shared/test-support.js";
import { createParityCheckHandler } from "./parity-check.js";

// Upstream returns a stale parity-history array as the JSON! payload
// (validated at v4.35.0) — the handler never reads it, fixtures mirror that.
const startResult = { parityCheck: { start: [] } } satisfies ParityCheckStartMutation;
const pauseResult = { parityCheck: { pause: [] } } satisfies ParityCheckPauseMutation;
const resumeResult = { parityCheck: { resume: [] } } satisfies ParityCheckResumeMutation;
const cancelResult = { parityCheck: { cancel: [] } } satisfies ParityCheckCancelMutation;

describe("parity_check validation and gate", () => {
  it("rejects correct with a non-start action before any GraphQL call", async () => {
    const { executor, calls } = recordingExecutor(cancelResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "cancel",
      correct: false,
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/only valid with action "start"/);
    expect(firstText(result)).toMatch(/No changes were made/);
    expect(calls).toHaveLength(0);
  });

  it("refuses without confirm and makes no calls", async () => {
    const { executor, calls } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/confirm/);
    expect(calls).toHaveLength(0);
  });

  it("names the correcting mode in the start refusal when correct is true", async () => {
    const { executor, calls } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      correct: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/correcting/);
    expect(calls).toHaveLength(0);
  });
});

describe("parity_check happy path", () => {
  it("starts read-only by default and reports requested, pointing to array_status", async () => {
    const { executor, calls } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/Parity check start requested \(read-only\)/);
    expect(firstText(result)).toMatch(/array_status/);
    expect(calls).toHaveLength(1);
    expect(calls[0].document).toBe(ParityCheckStartDocument);
    expect(calls[0].variables).toEqual({ correct: false });
  });

  it("forwards correct: true and names the correcting mode", async () => {
    const { executor, calls } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      correct: true,
      confirm: true,
    });

    expect(firstText(result)).toMatch(/correcting — writes corrections to parity/);
    expect(calls[0].variables).toEqual({ correct: true });
  });

  it.each([
    ["pause", ParityCheckPauseDocument, pauseResult],
    ["resume", ParityCheckResumeDocument, resumeResult],
    ["cancel", ParityCheckCancelDocument, cancelResult],
  ] as const)("dispatches %s and warns it may be a silent no-op", async (action, document, fixture) => {
    const { executor, calls } = recordingExecutor(fixture);

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action,
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(new RegExp(`Parity check ${action} requested`));
    expect(firstText(result)).toMatch(/no effect/);
    expect(calls[0].document).toBe(document);
    expect(calls[0].variables).toBeUndefined();
  });

  it("returns the structured outcome in detailed format", async () => {
    const { executor } = recordingExecutor(startResult);

    const result = await createParityCheckHandler(executor)({
      response_format: "detailed",
      action: "start",
      confirm: true,
    });

    expect(firstText(result)).toContain('"requested": "start"');
    expect(firstText(result)).toContain('"correct": false');
    expect(firstText(result)).toContain('"outcome": "requested"');
  });
});
```

Also append the failing registry assertion to `src/tools/registry.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/array/parity-check.test.ts src/tools/registry.test.ts`
Expected: FAIL — `./parity-check.js` does not exist; the registry assertion fails.

**Step 3: Implement `src/tools/array/parity-check.ts` (no error mapping yet — that is Task 6)**

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GraphQLExecutor } from "../../graphql/client.js";
import {
  ParityCheckCancelDocument,
  ParityCheckPauseDocument,
  ParityCheckResumeDocument,
  ParityCheckStartDocument,
} from "../../types/unraid/graphql.js";
import { requireConfirmation } from "../_shared/confirm.js";
import { type ResponseFormat, formatResponse, toolError } from "../_shared/respond.js";

const TOOL_NAME = "parity_check";

type ParityAction = "start" | "pause" | "resume" | "cancel";

/** A started check is read-only unless the caller opts into corrections. */
const DEFAULT_CORRECT = false;

/** Shared pointer copy — no read can confirm these mutations synchronously. */
const POINT_TO_STATUS = "Run array_status to confirm — status reads may lag a few seconds.";

const inputSchema = {
  response_format: z.enum(["concise", "detailed"]).default("concise"),
  action: z.enum(["start", "pause", "resume", "cancel"]),
  correct: z.boolean().optional(),
  confirm: z.boolean().optional(),
};

/** The validated handler arguments. */
interface ParityCheckArgs {
  response_format: ResponseFormat;
  action: ParityAction;
  correct?: boolean;
  confirm?: boolean;
}

/** Human description of the gated action for the confirm-gate refusal copy. */
function describeAction(args: ParityCheckArgs): string {
  if (args.action !== "start") {
    return `${args.action} the parity check`;
  }
  return args.correct === true
    ? "start a correcting parity check (writes corrections to parity)"
    : "start a read-only parity check";
}

/**
 * Validates `correct` usage, then applies the confirm gate. `correct` is only
 * meaningful on `start` (the web UI's "Write corrections to parity" checkbox)
 * — supplying it with any other action is rejected, never silently ignored.
 *
 * @param args - The validated handler arguments.
 * @returns `null` to proceed, or a refusal/validation error to return as-is.
 */
function gateRefusal(args: ParityCheckArgs): CallToolResult | null {
  if (args.correct !== undefined && args.action !== "start") {
    return toolError(
      '`correct` is only valid with action "start" (it selects a correcting check). No changes were made.',
    );
  }
  return requireConfirmation(args.confirm, describeAction(args));
}

/**
 * Dispatches one parity action to its typed mutation Document. The mutations'
 * `JSON!` payload is a stale parity-history array (validated at v4.35.0;
 * upstream marks the group WIP) — it is deliberately never read.
 *
 * @param client - The GraphQL executor.
 * @param action - The parity action to run.
 * @param correct - Whether a started check writes corrections to parity.
 */
async function runAction(
  client: GraphQLExecutor,
  action: ParityAction,
  correct: boolean,
): Promise<void> {
  switch (action) {
    case "start":
      await client.execute(ParityCheckStartDocument, { correct });
      return;
    case "pause":
      await client.execute(ParityCheckPauseDocument);
      return;
    case "resume":
      await client.execute(ParityCheckResumeDocument);
      return;
    case "cancel":
      await client.execute(ParityCheckCancelDocument);
      return;
  }
}

/** Success copy — "requested", never "done": the mutations return no usable status. */
function summarize(action: ParityAction, correct: boolean): string {
  if (action === "start") {
    const mode = correct ? "correcting — writes corrections to parity" : "read-only";
    return `Parity check start requested (${mode}). ${POINT_TO_STATUS}`;
  }
  return `Parity check ${action} requested. ${POINT_TO_STATUS} If no check was running, Unraid may accept this with no effect.`;
}

/**
 * Creates the `parity_check` handler bound to a GraphQL executor.
 *
 * @param client - The GraphQL executor used to run the parity mutations.
 * @returns An MCP handler controlling the parity job behind the confirm gate.
 */
export function createParityCheckHandler(client: GraphQLExecutor) {
  return async (args: ParityCheckArgs): Promise<CallToolResult> => {
    const { response_format, action } = args;
    const refusal = gateRefusal(args);
    if (refusal) {
      return refusal;
    }
    const correct = args.correct ?? DEFAULT_CORRECT;
    try {
      await runAction(client, action, correct);
      const detailed = { requested: action, correct, outcome: "requested" };
      return formatResponse(response_format, summarize(action, correct), detailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return toolError(`Failed to ${action} the parity check: ${message}`);
    }
  };
}

/**
 * Registers the destructive `parity_check` tool on the server.
 *
 * @param server - The MCP server to register the tool on.
 * @param client - The GraphQL executor the tool uses.
 */
export function registerParityCheck(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Control the Parity Check",
      description:
        'Starts, pauses, resumes, or cancels a parity check. `action: "start"` accepts `correct` (true = write corrections to parity, like the web UI checkbox; default false = read-only check). Requires `confirm: true`. The mutations return no usable status — run array_status afterward to confirm (status reads may lag a few seconds); pause/resume/cancel with no check running may be accepted with no effect. Requires an Unraid API key with ADMIN role. Behavior validated against Unraid API v4.35.0 (upstream marks these mutations WIP).',
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    createParityCheckHandler(client),
  );
}
```

Wire the registry: in `src/tools/registry.ts`, add `import { registerParityCheck } from "./array/parity-check.js";` and call `registerParityCheck(server, client);` directly after `registerParityHistory(server, client);`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/array/parity-check.test.ts src/tools/registry.test.ts`
Expected: PASS (all).

**Step 5: Quality gates + commit**

Run: `npm run typecheck && npm run build && npm test && npm run lint`

```bash
git add src/tools/array/parity-check.ts src/tools/array/parity-check.test.ts src/tools/registry.ts src/tools/registry.test.ts
git commit -m "feat(array): add parity_check tool — correct-only-with-start validation, confirm gate, dispatch"
```

---

### Task 6: `parity_check` error mapping (TDD)

**Files:**
- Modify: `src/tools/array/parity-check.ts`
- Modify: `src/tools/array/parity-check.test.ts`

**Step 1: Add the failing tests**

Append to `parity-check.test.ts` (add `throwingExecutor, rejectingExecutor` to the import):

```typescript
describe("parity_check error mapping", () => {
  it("maps the start-while-running guard to a clear refusal", async () => {
    const executor = throwingExecutor("Invalid parity check state: start");

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/already running/);
    expect(firstText(result)).toMatch(/No changes were made/);
  });

  it("reports the post-command history-read failure as issued-but-unverified", async () => {
    const executor = throwingExecutor(
      "Parity history file not found: /boot/config/parity-checks.log",
    );

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "start",
      confirm: true,
    });

    expect(result.isError).toBeUndefined();
    expect(firstText(result)).toMatch(/command was issued/);
    expect(firstText(result)).toMatch(/array_status/);
  });

  it("wraps unknown errors in the standard failure form", async () => {
    const executor = throwingExecutor("Forbidden resource");

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "cancel",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to cancel the parity check: Forbidden resource");
  });

  it("coerces non-Error rejections to strings", async () => {
    const executor = rejectingExecutor("denied");

    const result = await createParityCheckHandler(executor)({
      response_format: "concise",
      action: "pause",
      confirm: true,
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toBe("Failed to pause the parity check: denied");
  });
});
```

**Step 2: Run tests to verify the new mapped-message ones fail**

Run: `npx vitest run src/tools/array/parity-check.test.ts`
Expected: the first two FAIL; the last two already PASS.

**Step 3: Implement the mapping in `parity-check.ts`**

Add constants below `POINT_TO_STATUS`:

```typescript
/**
 * The API's action guard (validated at v4.35.0: only `start` while a check is
 * already running is filtered; pause/resume/cancel are always forwarded).
 * Matching is best-effort under production error masking.
 */
const INVALID_STATE_MESSAGE = "Invalid parity check state";

/** Thrown by the post-command history read AFTER the command already fired. */
const HISTORY_READ_MESSAGE = "Parity history file not found";
```

Add the mapper above `createParityCheckHandler`:

```typescript
/** Inputs for mapping a thrown message to a known, non-generic result. */
interface KnownErrorInput {
  action: ParityAction;
  message: string;
  format: ResponseFormat;
}

/**
 * Maps the API's known messages: the start-while-running guard → a real
 * refusal; the post-command history-read failure → the command already fired,
 * so report it as issued-but-unverified rather than a failure. Returns `null`
 * for unknown messages (generic failure path).
 *
 * @param input - The action, the thrown message, and the response format.
 * @returns A mapped `CallToolResult`, or `null` when the message is unknown.
 */
function mapKnownError(input: KnownErrorInput): CallToolResult | null {
  const { action, message, format } = input;
  if (message.includes(INVALID_STATE_MESSAGE)) {
    return toolError(
      `Unraid refused to ${action} the parity check — a check is already running (run array_status to see it). No changes were made.`,
    );
  }
  if (message.includes(HISTORY_READ_MESSAGE)) {
    const summary = `The parity check ${action} command was issued, but the API's post-command history read failed. ${POINT_TO_STATUS}`;
    const detailed = { requested: action, outcome: "issued-unverified", apiMessage: message };
    return formatResponse(format, summary, detailed);
  }
  return null;
}
```

Replace the catch block's body in `createParityCheckHandler` with:

```typescript
      const message = error instanceof Error ? error.message : String(error);
      return (
        mapKnownError({ action, message, format: response_format }) ??
        toolError(`Failed to ${action} the parity check: ${message}`)
      );
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/array/parity-check.test.ts`
Expected: PASS (all).

**Step 5: Quality gates + commit**

Run: `npm run typecheck && npm run build && npm test && npm run lint`

```bash
git add src/tools/array/parity-check.ts src/tools/array/parity-check.test.ts
git commit -m "feat(array): map parity guard/history-read errors to refusal/unverified results"
```

---

### Task 7: README rows + design-doc status

**Files:**
- Modify: `README.md` (tools table — after the `parity_history` row)
- Modify: `docs/plans/2026-06-06-array-parity-tools-design.md` (Status line)

**Step 1: Add the two tool rows after the `parity_history` row, matching the table's existing column format**

```markdown
| `array_action` | Starts or stops the array behind a confirm gate (stop also requires `acknowledge_risk` — Unraid takes every share, Docker container, and VM offline). Reports the request; run `array_status` to confirm. |
| `parity_check` | Starts (optionally `correct`ing), pauses, resumes, or cancels a parity check behind a confirm gate. Reports the request; run `array_status` to confirm. |
```

Check the README for any other section that lists tools or counts them (e.g. an intro sentence) and update consistently.

**Step 2: In the design doc, change the Status line**

```markdown
**Status:** Implemented — see docs/plans/2026-06-06-array-parity-tools.md
```

**Step 3: Quality gates + commit**

Run: `npm run typecheck && npm run build && npm test && npm run lint`

```bash
git add README.md docs/plans/2026-06-06-array-parity-tools-design.md
git commit -m "docs: promote array_action and parity_check to shipped"
```

---

### Task 8: Full verification (no new code)

**Step 1: Quality gates from clean**

Run: `npm run typecheck && npm run build && npm test && npm run lint`
Expected: all pass, zero warnings.

**Step 2: Codegen idempotency**

Run: `npm run generate && git diff --exit-code src/types/unraid/graphql.ts`
Expected: exit 0 (no drift between committed types and the operations).

**Step 3: stdio smoke — initialize → tools/list via the MCP SDK client**

```bash
node --input-type=module -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, UNRAID_API_URL: "https://127.0.0.1/graphql", UNRAID_API_KEY: "smoke-key" },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
const names = tools.map((tool) => tool.name);
const expected = ["array_action", "parity_check", "array_status", "parity_history"];
const missing = expected.filter((name) => !names.includes(name));
console.log(names.sort().join(","));
if (missing.length > 0) { console.error("MISSING: " + missing.join(",")); process.exit(1); }
await client.close();
'
```

Expected: prints the full tool list including `array_action` and `parity_check`; exit 0. (If `dist/index.js` is not the build entry, check `package.json` `bin`/`main` and `ls dist/` for the actual path.)

**Step 4: Working tree clean check**

Run: `git status --porcelain`
Expected: empty (everything committed).
