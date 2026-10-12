import { describe, expect, it } from "vitest";
import type { MobileMessage } from "../api/types";
import { applyStreamDelta, buildChatEntries, visibleStreamText, type ChatEntry } from "./messages";

function toolMsg(over: Partial<MobileMessage>): MobileMessage {
  return {
    role: "tool",
    text: "",
    tool_name: "bash_exec",
    tool_status: "done",
    tool_args: { command: "ls -la" },
    content: "file1\nfile2",
    ...over,
  } as MobileMessage;
}

describe("buildChatEntries", () => {
  it("连续 tool 消息归入一个 toolGroup", () => {
    const entries = buildChatEntries([
      { role: "user", text: "hi" },
      toolMsg({}),
      toolMsg({ tool_args: { command: "pwd" } }),
      { role: "assistant", text: "done" },
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["user", "toolGroup", "assistant"]);
    const g = entries[1];
    expect(g.kind === "toolGroup" && g.steps).toHaveLength(2);
  });

  it("toolGroup 被 user/assistant/system 消息打断", () => {
    const entries = buildChatEntries([
      toolMsg({}),
      { role: "assistant", text: "a" },
      toolMsg({}),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["toolGroup", "assistant", "toolGroup"]);
  });

  it("assistant 携带 reasoning", () => {
    const entries = buildChatEntries([
      { role: "assistant", text: "ok", reasoning: "先看看目录" },
    ]);
    const a = entries[0];
    expect(a.kind === "assistant" && a.reasoning).toBe("先看看目录");
  });

  it("bash_exec 提取 command，其它工具取参数 JSON", () => {
    const entries = buildChatEntries([
      toolMsg({}),
      toolMsg({ tool_name: "file_read", tool_args: { path: "/tmp/a" }, content: "" }),
    ]);
    const g = entries[0];
    if (g.kind !== "toolGroup") throw new Error("not group");
    expect(g.steps[0].detail).toBe("ls -la");
    expect(g.steps[1].detail).toContain("/tmp/a");
  });

  it("error 状态与结果预览截断", () => {
    const entries = buildChatEntries([
      toolMsg({ tool_status: "error", content: "x".repeat(200) }),
    ]);
    const g = entries[0];
    if (g.kind !== "toolGroup") throw new Error("not group");
    expect(g.steps[0].status).toBe("error");
    expect(g.steps[0].resultPreview).toHaveLength(120);
  });

  it("老消息（无 tool 字段）按纯文本回退不崩溃", () => {
    const entries = buildChatEntries([
      { role: "user", text: "u" },
      { role: "assistant", text: "a" },
      { role: "system", text: "s" },
      toolMsg({ tool_name: undefined, tool_args: undefined, content: undefined }),
    ]);
    expect(entries).toHaveLength(4);
    const g = entries[3];
    if (g.kind !== "toolGroup") throw new Error("not group");
    expect(g.steps[0].toolName).toBe("tool");
    expect(g.steps[0].detail).toBe("");
  });
});

describe("applyStreamDelta", () => {
  const pending = { kind: "pending" as const, key: "local-pending-1" };

  it("首个增量把 pending 原位替换为 streaming 气泡", () => {
    const next = applyStreamDelta(
      [{ kind: "user", key: "u1", text: "hi" }, pending],
      "local-pending-1",
      "你好",
    );
    expect(next.map((e) => e.kind)).toEqual(["user", "streaming"]);
    const s = next[1];
    expect(s.kind === "streaming" && s.text).toBe("你好");
  });

  it("后续增量累积追加文本", () => {
    const first = applyStreamDelta([pending], "local-pending-1", "A");
    const second = applyStreamDelta(first, "local-pending-1", "B");
    const third = applyStreamDelta(second, "local-pending-1", "C");
    const s = third[0];
    expect(s.kind === "streaming" && s.text).toBe("ABC");
  });

  it("pending 已被移除（快照重建过）时尾部追加", () => {
    const base: ChatEntry[] = [{ kind: "user", key: "u1", text: "hi" }];
    const next = applyStreamDelta(base, "k", "x");
    expect(next).toHaveLength(2);
    expect(next[1].kind).toBe("streaming");
  });

  it("空增量原样返回", () => {
    const list = [pending];
    expect(applyStreamDelta(list, "k", "")).toBe(list);
    expect(applyStreamDelta(null, "k", "")).toEqual([]);
  });

  it("不改动输入数组", () => {
    const list = [pending];
    applyStreamDelta(list, "local-pending-1", "text");
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("pending");
  });
});

describe("visibleStreamText", () => {
  it("剥除完整闭合的 thinking 块", () => {
    expect(visibleStreamText("<thinking>想一下</thinking>答案是1")).toBe("答案是1");
  });

  it("剥除协议规范的 Mattis 块（safe_stream 规范形态）", () => {
    expect(visibleStreamText("<think>想一下</think>答案是1")).toBe("答案是1");
  });

  it("剥除流式进行中的未闭合尾部", () => {
    expect(visibleStreamText("<thinking>想")).toBe("");
    expect(visibleStreamText("<think>想")).toBe("");
    expect(visibleStreamText("<thinking>想一下</thinking>答<thinking>继续想")).toBe("答");
    expect(visibleStreamText("<think>想一下</think>答<think>继续想")).toBe("答");
  });

  it("剥除被分片截断的标签前缀", () => {
    expect(visibleStreamText("答案")).toBe("答案");
    expect(visibleStreamText("答案<thi")).toBe("答案");
    expect(visibleStreamText("答案<t")).toBe("答案");
    expect(visibleStreamText("<")).toBe("");
  });

  it("多轮 thinking 块全部剥除，答案间内容保留", () => {
    const text = "<thinking>a</thinking>第一段<thinking>b</thinking>第二段";
    expect(visibleStreamText(text)).toBe("第一段第二段");
    const thinkText = "<think>a</think>第一段<think>b</think>第二段";
    expect(visibleStreamText(thinkText)).toBe("第一段第二段");
  });
});
