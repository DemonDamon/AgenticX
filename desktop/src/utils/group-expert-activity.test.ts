/**
 * Author: Damon Li
 */
import { describe, expect, it } from "vitest";
import {
  formatActivityElapsed,
  formatGroupToolLabel,
  hasActiveGroupExpertActivities,
  parseToolNameFromProgressText,
  reduceGroupExpertActivity,
  sortGroupExpertActivities,
  stripTrailingStatusEllipsis,
  type GroupExpertActivity,
} from "./group-expert-activity";

const BASE = {
  agentId: "researcher",
  avatarName: "调研",
  now: 1_000,
};

function reduce(
  current: GroupExpertActivity | undefined,
  event: Partial<Parameters<typeof reduceGroupExpertActivity>[1]>,
) {
  return reduceGroupExpertActivity(current, {
    type: "typing",
    ...BASE,
    ...event,
  });
}

describe("reduceGroupExpertActivity", () => {
  it("creates a thinking card from typing", () => {
    const next = reduce(undefined, { type: "typing" });
    expect(next.phase).toBe("thinking");
    expect(next.summary).toBe("正在思考");
    expect(next.startedAt).toBe(1_000);
    expect(next.toolSteps).toEqual([]);
  });

  it("maps progress calling to a Chinese tool summary", () => {
    const typed = reduce(undefined, { type: "typing" });
    const next = reduce(typed, {
      type: "progress",
      toolName: "web_search",
      toolPhase: "calling",
      toolCallId: "c1",
      now: 2_000,
    });
    expect(next.phase).toBe("tool");
    expect(next.summary).toBe("正在使用网络检索");
    expect(next.startedAt).toBe(1_000);
    expect(next.toolSteps).toEqual([
      { callId: "c1", toolName: "web_search", phase: "calling", updatedAt: 2_000 },
    ]);
  });

  it("streams command detail on calling and keeps it when the result arrives", () => {
    const calling = reduce(undefined, {
      type: "progress",
      toolName: "bash_exec",
      toolPhase: "calling",
      toolCallId: "c1",
      toolDetail: 'grep -n countdown fanshu_game.html',
      now: 1_000,
    });
    expect(calling.toolSteps[0]?.detail).toBe("grep -n countdown fanshu_game.html");
    const done = reduce(calling, {
      type: "progress",
      toolName: "bash_exec",
      toolPhase: "done",
      toolCallId: "c1",
      toolDetail: "128:function countdown() {",
      now: 3_000,
    });
    expect(done.toolSteps[0]?.detail).toBe("grep -n countdown fanshu_game.html");
    expect(done.toolSteps[0]?.output).toBe("128:function countdown() {");
    expect(done.toolSteps[0]?.phase).toBe("done");
  });

  it("keeps tool phase on done and updates the same callId", () => {
    const calling = reduce(undefined, {
      type: "progress",
      toolName: "file_read",
      toolPhase: "calling",
      toolCallId: "c1",
      now: 1_000,
    });
    const done = reduce(calling, {
      type: "progress",
      toolName: "file_read",
      toolPhase: "done",
      toolCallId: "c1",
      now: 3_000,
    });
    expect(done.phase).toBe("tool");
    expect(done.summary).toBe("已完成文件读取，继续处理中");
    expect(done.toolSteps).toHaveLength(1);
    expect(done.toolSteps[0]).toMatchObject({ callId: "c1", phase: "done", updatedAt: 3_000 });
  });

  it("uses sanitized Chinese progress content when no tool fields exist", () => {
    const next = reduce(undefined, {
      type: "progress",
      content: "正在检查仓库…",
      now: 1_500,
    });
    expect(next.summary).toBe("正在检查仓库");
    expect(next.phase).toBe("thinking");
  });

  it("parses raw backend tool lines instead of showing snake_case", () => {
    expect(parseToolNameFromProgressText("正在调用工具：web_search")).toBe("web_search");
    const next = reduce(undefined, {
      type: "progress",
      content: "正在调用工具：web_search",
      toolCallId: "c9",
      now: 2_000,
    });
    expect(next.summary).toBe("正在使用网络检索");
    expect(next.summary).not.toContain("web_search");
  });

  it("hides unknown snake_case tools behind a generic phrase", () => {
    const next = reduce(undefined, {
      type: "progress",
      toolName: "mystery_tool",
      toolPhase: "calling",
      toolCallId: "c2",
    });
    expect(next.summary).toBe("正在执行工具");
    expect(next.summary).not.toMatch(/mystery_tool/);
    expect(formatGroupToolLabel("mystery_tool")).toBe("");
  });

  it("moves to waiting for blocked and clarification", () => {
    const typed = reduce(undefined, { type: "typing" });
    const blocked = reduce(typed, { type: "blocked", content: "rm -rf /tmp", now: 4_000 });
    expect(blocked.phase).toBe("waiting");
    expect(blocked.summary).toBe("等待你的确认…");
    expect(blocked.startedAt).toBe(1_000);

    const clarifying = reduce(typed, { type: "clarification", content: "哪个仓库？", now: 5_000 });
    expect(clarifying.phase).toBe("waiting");
    expect(clarifying.summary).toBe("需要你补充信息…");
  });

  it("caps tool steps at the latest 6", () => {
    let current: GroupExpertActivity | undefined;
    for (let i = 0; i < 8; i += 1) {
      current = reduce(current, {
        type: "progress",
        toolName: "bash_exec",
        toolPhase: "calling",
        toolCallId: `c${i}`,
        now: 1_000 + i,
      });
    }
    expect(current?.toolSteps).toHaveLength(6);
    expect(current?.toolSteps[0]?.callId).toBe("c2");
    expect(current?.toolSteps[5]?.callId).toBe("c7");
  });

  it("does not let an empty avatarUrl overwrite an existing one", () => {
    const withUrl = reduce(undefined, { type: "typing", avatarUrl: "https://img/a.png" });
    const next = reduce(withUrl, { type: "progress", content: "正在检查仓库…", avatarUrl: "" });
    expect(next.avatarUrl).toBe("https://img/a.png");
  });

  it("returns to thinking after waiting while keeping startedAt", () => {
    const waiting = reduce(undefined, { type: "blocked", now: 1_000 });
    const resumed = reduce(waiting, { type: "typing", now: 9_000 });
    expect(resumed.phase).toBe("thinking");
    expect(resumed.summary).toBe("正在思考");
    expect(resumed.startedAt).toBe(1_000);
  });
});

describe("activity helpers", () => {
  it("strips trailing typographic ellipsis from in-progress copy", () => {
    expect(stripTrailingStatusEllipsis("已完成文件读取，继续处理中…")).toBe(
      "已完成文件读取，继续处理中",
    );
    expect(stripTrailingStatusEllipsis("正在思考...")).toBe("正在思考");
    expect(stripTrailingStatusEllipsis("等待你的确认…")).toBe("等待你的确认");
  });

  it("formats elapsed seconds and sorts by startedAt then agentId", () => {
    expect(formatActivityElapsed(1_000, 13_000)).toBe("12s");
    expect(hasActiveGroupExpertActivities({})).toBe(false);
    const sorted = sortGroupExpertActivities({
      b: {
        agentId: "b",
        avatarName: "B",
        phase: "thinking",
        summary: "正在思考",
        startedAt: 2,
        updatedAt: 2,
        toolSteps: [],
      },
      a: {
        agentId: "a",
        avatarName: "A",
        phase: "thinking",
        summary: "正在思考",
        startedAt: 2,
        updatedAt: 2,
        toolSteps: [],
      },
    });
    expect(sorted.map((row) => row.agentId)).toEqual(["a", "b"]);
  });
});
