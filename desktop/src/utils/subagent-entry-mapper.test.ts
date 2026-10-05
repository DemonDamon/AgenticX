import { describe, expect, it } from "vitest";
import { mapStartedEvent, mapTerminalSessionPatch } from "./subagent-entry-mapper";

describe("mapStartedEvent", () => {
  it("delegation started event binds to the initiating session and records the avatar session separately", () => {
    const entry = mapStartedEvent(
      {
        agent_id: "dlg-e1715910",
        name: "阮和鸣",
        role: "游戏音频与声效设计师",
        delegation: true,
        avatar_session_id: "avatar-session-1",
        provider: "deepseek",
        model: "deepseek-chat",
        task: "写一份音频设计方案",
      },
      "meta-session-1",
    );
    expect(entry).toMatchObject({
      id: "dlg-e1715910",
      name: "阮和鸣",
      role: "游戏音频与声效设计师",
      provider: "deepseek",
      model: "deepseek-chat",
      task: "写一份音频设计方案",
      sessionId: "meta-session-1",
      avatarSessionId: "avatar-session-1",
      kind: "delegate",
      status: "running",
      currentAction: "委派执行中",
    });
  });

  it("plain spawned subagent binds to the initiating session without avatarSessionId", () => {
    const entry = mapStartedEvent(
      {
        agent_id: "sa-abc123",
        name: "researcher",
        task: "调研",
      },
      "meta-session-1",
    );
    expect(entry).toMatchObject({
      id: "sa-abc123",
      sessionId: "meta-session-1",
      kind: "subagent",
      currentAction: "执行中",
    });
    expect(entry?.avatarSessionId).toBeUndefined();
  });

  it("returns null when agent_id is missing", () => {
    expect(mapStartedEvent({}, "meta-session-1")).toBeNull();
    expect(mapStartedEvent(undefined, "meta-session-1")).toBeNull();
  });

  it("skips tracking when the delegation event arrives on the avatar session's own stream", () => {
    const entry = mapStartedEvent(
      {
        agent_id: "dlg-e1715910",
        delegation: true,
        avatar_session_id: "avatar-session-1",
      },
      "avatar-session-1",
    );
    expect(entry).toBeNull();
  });

  it("falls back to agent id as name and role defaults", () => {
    const spawned = mapStartedEvent({ agent_id: "sa-x" }, "meta-session-1");
    expect(spawned).toMatchObject({ name: "sa-x", role: "worker", task: "" });

    const delegated = mapStartedEvent({ agent_id: "dlg-1", delegation: true }, "meta-session-1");
    expect(delegated).toMatchObject({ name: "dlg-1", role: "delegated avatar", kind: "delegate" });
  });
});

describe("mapTerminalSessionPatch", () => {
  it("only patches avatarSessionId and never sessionId", () => {
    const patch = mapTerminalSessionPatch({ avatar_session_id: "avatar-session-1" });
    expect(patch).toEqual({ avatarSessionId: "avatar-session-1" });
    expect(patch).not.toHaveProperty("sessionId");
  });

  it("returns an empty patch when avatar_session_id is absent", () => {
    expect(mapTerminalSessionPatch({})).toEqual({});
    expect(mapTerminalSessionPatch(undefined)).toEqual({});
  });
});
