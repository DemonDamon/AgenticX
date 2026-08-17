import { describe, expect, it } from "vitest";
import { resolveGroupMemberActivity } from "./group-member-activity";

const AVATARS = ["wen", "cheng", "lin"];

describe("resolveGroupMemberActivity", () => {
  it("marks every member idle when only meta has spoken", () => {
    const out = resolveGroupMemberActivity(
      [
        { role: "assistant", agentId: "__meta__", timestamp: 1 },
        { role: "assistant", agentId: "__meta__", timestamp: 2 },
      ],
      AVATARS,
    );
    for (const id of AVATARS) {
      expect(out.get(id)?.state).toBe("idle");
      expect(out.get(id)?.replies).toBe(0);
    }
  });

  it("marks a member replied when they have assistant messages", () => {
    const out = resolveGroupMemberActivity(
      [
        { role: "assistant", agentId: "__meta__", timestamp: 1 },
        { role: "assistant", agentId: "cheng", timestamp: 2 },
        { role: "assistant", agentId: "cheng", timestamp: 3 },
      ],
      AVATARS,
    );
    expect(out.get("cheng")?.state).toBe("replied");
    expect(out.get("cheng")?.replies).toBe(2);
    expect(out.get("wen")?.state).toBe("idle");
    expect(out.get("lin")?.state).toBe("idle");
  });

  it("prefers running over replied when the member is active", () => {
    const out = resolveGroupMemberActivity(
      [{ role: "assistant", agentId: "cheng", timestamp: 1 }],
      AVATARS,
      ["cheng"],
    );
    expect(out.get("cheng")?.state).toBe("running");
    expect(out.get("cheng")?.replies).toBe(1);
  });
});
