import { describe, expect, it } from "vitest";

import { MaScheduleValidationError, normalizeScheduleInput } from "../ma-schedules";

const AGENT = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function createBody(extra: Record<string, unknown> = {}) {
  return {
    name: "日报",
    agent_id: AGENT,
    cron: "0 9 * * 1-5",
    input_template: "生成 {{date}} 的日报",
    ...extra,
  };
}

describe("schedule input", () => {
  it("rejects pinned without a version and follow_routing with a version", () => {
    expect(() => normalizeScheduleInput(createBody({ version_policy: "pinned" }), "create")).toThrow(
      "pinned_version: is required",
    );
    expect(() =>
      normalizeScheduleInput(createBody({ version_policy: "follow_routing", pinned_version: 2 }), "create"),
    ).toThrow("pinned_version: must be null unless version_policy is pinned");
  });

  it("rejects oversized templates, too many vaults, run_as, and a short grace", () => {
    expect(() => normalizeScheduleInput(createBody({ input_template: "a".repeat(16385) }), "create")).toThrow(
      MaScheduleValidationError,
    );
    expect(() =>
      normalizeScheduleInput(
        createBody({ vault_ids: Array.from({ length: 21 }, () => AGENT) }),
        "create",
      ),
    ).toThrow(MaScheduleValidationError);
    expect(() => normalizeScheduleInput(createBody({ run_as_user_id: AGENT }), "create")).toThrow(
      "run_as_user_id: is not allowed",
    );
    expect(() => normalizeScheduleInput(createBody({ misfire_grace_seconds: 30 }), "create")).toThrow(
      MaScheduleValidationError,
    );
  });

  it("accepts a follow_routing schedule and defaults the timezone", () => {
    const input = normalizeScheduleInput(createBody(), "create");
    expect(input.versionPolicy).toBe("follow_routing");
    expect(input.pinnedVersion).toBeNull();
    expect(input.timezone).toBe("Asia/Shanghai");
    expect(input.misfireGraceSeconds).toBe(300);
  });
});
