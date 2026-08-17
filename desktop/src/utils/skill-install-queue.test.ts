import { describe, expect, it } from "vitest";

import { decideSkillInstallRequest } from "./skill-install-queue";

describe("decideSkillInstallRequest", () => {
  it("starts immediately when the install slot is idle", () => {
    expect(
      decideSkillInstallRequest({
        requestedKey: "skill-a",
        activeKey: null,
        confirmationKey: null,
        queuedKeys: [],
      }),
    ).toBe("start");
  });

  it("queues a different skill while an install is running", () => {
    expect(
      decideSkillInstallRequest({
        requestedKey: "skill-b",
        activeKey: "skill-a",
        confirmationKey: null,
        queuedKeys: [],
      }),
    ).toBe("queue");
  });

  it("queues a different skill while confirmation is pending", () => {
    expect(
      decideSkillInstallRequest({
        requestedKey: "skill-b",
        activeKey: null,
        confirmationKey: "skill-a",
        queuedKeys: [],
      }),
    ).toBe("queue");
  });

  it.each([
    { activeKey: "skill-a", confirmationKey: null, queuedKeys: [] },
    { activeKey: null, confirmationKey: "skill-a", queuedKeys: [] },
    { activeKey: null, confirmationKey: null, queuedKeys: ["skill-a"] },
  ])("ignores a duplicate request already owned by the pipeline", (state) => {
    expect(
      decideSkillInstallRequest({
        requestedKey: "skill-a",
        ...state,
      }),
    ).toBe("ignore");
  });
});
