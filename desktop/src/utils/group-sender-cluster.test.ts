import { describe, expect, it } from "vitest";
import {
  clusterFlagsForGroupRows,
  groupSenderClusterKey,
  lastAdjacentClusterKey,
} from "./group-sender-cluster";

describe("groupSenderClusterKey", () => {
  it("keys owner user rows as user:self", () => {
    expect(groupSenderClusterKey({ role: "user" })).toBe("user:self");
  });

  it("keys peer humans separately from the owner", () => {
    expect(
      groupSenderClusterKey({ role: "user", speakerUserId: "human:feishu:ou_1" }),
    ).toBe("user:human:feishu:ou_1");
    expect(groupSenderClusterKey({ role: "user" })).not.toBe(
      groupSenderClusterKey({ role: "user", speakerUserId: "human:feishu:ou_1" }),
    );
  });

  it("prefers avatar id then agent id for assistants", () => {
    expect(
      groupSenderClusterKey({ role: "assistant", agentId: "legal", avatarName: "法务" }, "legal-1"),
    ).toBe("assistant:legal-1");
    expect(groupSenderClusterKey({ role: "assistant", agentId: "finance" })).toBe(
      "assistant:finance",
    );
  });

  it("falls back to a real display name and skips 分身", () => {
    expect(groupSenderClusterKey({ role: "assistant", avatarName: "架构师" })).toBe(
      "assistant:name:架构师",
    );
    expect(groupSenderClusterKey({ role: "assistant", avatarName: "分身" })).toBeNull();
  });

  it("returns null for system notices and non-talk roles", () => {
    expect(groupSenderClusterKey({ role: "assistant", agentId: "meta", systemNotice: true })).toBeNull();
    expect(groupSenderClusterKey({ role: "tool", agentId: "legal" })).toBeNull();
  });
});

describe("clusterFlagsForGroupRows", () => {
  it("marks the second same-sender assistant as a continuation", () => {
    const flags = clusterFlagsForGroupRows(
      [
        { kind: "message", message: { id: "a1", role: "assistant", agentId: "legal" } },
        { kind: "message", message: { id: "a2", role: "assistant", agentId: "legal" } },
      ],
      (message) => groupSenderClusterKey(message),
    );
    expect(flags.get("a1")).toEqual({ senderKey: "assistant:legal", clusterContinue: false });
    expect(flags.get("a2")).toEqual({ senderKey: "assistant:legal", clusterContinue: true });
  });

  it("does not cluster two different experts", () => {
    const flags = clusterFlagsForGroupRows(
      [
        { kind: "message", message: { id: "a1", role: "assistant", agentId: "legal" } },
        { kind: "message", message: { id: "a2", role: "assistant", agentId: "finance" } },
      ],
      (message) => groupSenderClusterKey(message),
    );
    expect(flags.get("a2")?.clusterContinue).toBe(false);
  });

  it("breaks the chain across a tool group", () => {
    const flags = clusterFlagsForGroupRows(
      [
        { kind: "message", message: { id: "a1", role: "assistant", agentId: "legal" } },
        { kind: "tool_group" },
        { kind: "message", message: { id: "a2", role: "assistant", agentId: "legal" } },
      ],
      (message) => groupSenderClusterKey(message),
    );
    expect(flags.get("a2")?.clusterContinue).toBe(false);
  });

  it("clusters owner user turns and not a peer after the owner", () => {
    const flags = clusterFlagsForGroupRows(
      [
        { kind: "message", message: { id: "u1", role: "user" } },
        { kind: "message", message: { id: "u2", role: "user" } },
        { kind: "message", message: { id: "u3", role: "user", speakerUserId: "human:x" } },
      ],
      (message) => groupSenderClusterKey(message),
    );
    expect(flags.get("u2")?.clusterContinue).toBe(true);
    expect(flags.get("u3")?.clusterContinue).toBe(false);
  });
});

describe("lastAdjacentClusterKey", () => {
  it("reads the last talk row and ignores a trailing tool group", () => {
    const rows = [
      { kind: "message" as const, message: { id: "a1", role: "assistant", agentId: "legal" } },
      { kind: "tool_group" as const },
    ];
    const flags = clusterFlagsForGroupRows(rows, (message) => groupSenderClusterKey(message));
    expect(lastAdjacentClusterKey(flags, rows)).toBeNull();
    expect(
      lastAdjacentClusterKey(flags, [
        { kind: "message", message: { id: "a1", role: "assistant", agentId: "legal" } },
      ]),
    ).toBe("assistant:legal");
  });
});
