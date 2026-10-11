import { describe, expect, it } from "vitest";
import type { MobileMessage } from "../api/types";
import { buildChatEntries } from "./messages";

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
