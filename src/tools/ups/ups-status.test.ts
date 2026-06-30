import { describe, expect, it } from "vitest";
import type { UpsStatusQuery } from "../../types/unraid/graphql.js";
import { UpsStatusDocument } from "../../types/unraid/graphql.js";
import {
  firstText,
  recordingExecutor,
  rejectingExecutor,
  throwingExecutor,
} from "../_shared/test-support.js";
import { createUpsStatusHandler } from "./ups-status.js";

/** A real UPS on mains power reporting a model (apcaccess STATUS is uppercase). */
const online = {
  upsDevices: [
    {
      id: "CyberPower CP1500PFCLCD",
      name: "CyberPower CP1500PFCLCD",
      model: "CyberPower CP1500PFCLCD",
      status: "ONLINE",
      battery: { chargeLevel: 100, estimatedRuntime: 2898 },
      power: {
        inputVoltage: 121,
        outputVoltage: 121,
        loadPercentage: 19,
        nominalPower: 865,
        currentPower: 164.35,
      },
    },
  ],
} satisfies UpsStatusQuery;

/** A real UPS running on battery. */
const onBattery = {
  upsDevices: [
    {
      ...online.upsDevices[0],
      status: "ONBATT",
      battery: { chargeLevel: 87, estimatedRuntime: 2520 },
      power: { ...online.upsDevices[0].power, loadPercentage: 22 },
    },
  ],
} satisfies UpsStatusQuery;

describe("ups_status handler", () => {
  it("renders a real on-battery device concisely", async () => {
    const { executor } = recordingExecutor(onBattery);

    const result = await createUpsStatusHandler(executor)({ response_format: "concise" });

    const text = firstText(result);
    expect(text).toMatch(/CyberPower CP1500PFCLCD \(CyberPower CP1500PFCLCD\) — ONBATT/);
    expect(text).toMatch(/battery 87% · ~42m left · load 22%/);
  });

  it("renders a real online device concisely with the watts note", async () => {
    const { executor } = recordingExecutor(online);

    const result = await createUpsStatusHandler(executor)({ response_format: "concise" });

    expect(firstText(result)).toMatch(
      /— ONLINE · battery 100% · ~48m left · load 19% \(164\.35W \/ 865W\)/,
    );
  });

  it("humanizes a multi-hour runtime", async () => {
    const longRuntime = {
      upsDevices: [
        { ...online.upsDevices[0], battery: { chargeLevel: 100, estimatedRuntime: 7320 } },
      ],
    } satisfies UpsStatusQuery;
    const { executor } = recordingExecutor(longRuntime);

    const result = await createUpsStatusHandler(executor)({ response_format: "concise" });

    expect(firstText(result)).toMatch(/~2h 2m left/);
  });

  it("omits the watts note when the UPS does not report wattage", async () => {
    const noWatts = {
      upsDevices: [
        {
          ...online.upsDevices[0],
          power: { ...online.upsDevices[0].power, nominalPower: null, currentPower: null },
        },
      ],
    } satisfies UpsStatusQuery;
    const { executor } = recordingExecutor(noWatts);

    const result = await createUpsStatusHandler(executor)({ response_format: "concise" });

    expect(firstText(result)).not.toMatch(/W \//);
    expect(firstText(result)).toMatch(/load 19%$/m);
  });

  it("returns the raw payload for detailed and never selects health", async () => {
    const { executor } = recordingExecutor(online);

    const result = await createUpsStatusHandler(executor)({ response_format: "detailed" });

    const parsed = JSON.parse(firstText(result));
    expect(parsed).toEqual(online);
    expect(firstText(result)).not.toMatch(/health/);
  });

  it("dispatches the typed UpsStatus document", async () => {
    const { executor, calls } = recordingExecutor(online);

    await createUpsStatusHandler(executor)({ response_format: "concise" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.document).toBe(UpsStatusDocument);
  });

  it("reports no devices defensively when the list is empty", async () => {
    const empty = { upsDevices: [] } satisfies UpsStatusQuery;
    const { executor } = recordingExecutor(empty);

    const result = await createUpsStatusHandler(executor)({ response_format: "concise" });

    expect(firstText(result)).toMatch(/No UPS devices reported\./);
  });

  it("returns an error result when the client throws", async () => {
    const result = await createUpsStatusHandler(
      throwingExecutor("Failed to get UPS data: No UPS data returned from apcaccess"),
    )({ response_format: "concise" });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/Failed to fetch UPS status/);
    expect(firstText(result)).toMatch(/No UPS data returned from apcaccess/);
  });

  it("coerces a non-Error rejection to a string", async () => {
    const result = await createUpsStatusHandler(rejectingExecutor("plain refusal"))({
      response_format: "concise",
    });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/plain refusal/);
  });

  it("suppresses the fabricated placeholder device (no model + default Online)", async () => {
    const placeholder = {
      upsDevices: [
        {
          id: "ups1",
          name: "My UPS",
          model: "APC Back-UPS Pro 1500",
          status: "Online",
          battery: { chargeLevel: 100, estimatedRuntime: 3600 },
          power: {
            inputVoltage: 120.5,
            outputVoltage: 120.5,
            loadPercentage: 25,
            nominalPower: null,
            currentPower: null,
          },
        },
      ],
    } satisfies UpsStatusQuery;
    const { executor } = recordingExecutor(placeholder);

    const concise = await createUpsStatusHandler(executor)({ response_format: "concise" });
    const detailed = await createUpsStatusHandler(executor)({ response_format: "detailed" });

    expect(firstText(concise)).toMatch(/No live UPS data/);
    expect(firstText(concise)).not.toMatch(/battery 100%/);
    const parsed = JSON.parse(firstText(detailed));
    expect(parsed.upsDetected).toBe(false);
    expect(parsed.placeholderPayload).toEqual(placeholder);
  });

  it("surfaces a real alert status even when device identity is the placeholder", async () => {
    const placeholderAlert = {
      upsDevices: [
        {
          id: "ups1",
          name: "My UPS",
          model: "APC Back-UPS Pro 1500",
          status: "ONBATT",
          battery: { chargeLevel: 100, estimatedRuntime: 3600 },
          power: {
            inputVoltage: 120.5,
            outputVoltage: 120.5,
            loadPercentage: 25,
            nominalPower: null,
            currentPower: null,
          },
        },
      ],
    } satisfies UpsStatusQuery;
    const { executor } = recordingExecutor(placeholderAlert);

    const result = await createUpsStatusHandler(executor)({ response_format: "concise" });

    const text = firstText(result);
    expect(text).toMatch(/ONBATT/);
    expect(text).not.toMatch(/No live UPS data/);
    expect(text).toMatch(/no device identity/);
  });
});
