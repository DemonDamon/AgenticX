import { describe, expect, it } from "vitest";
import type { MobileMessage } from "../api/types";
import {
  aggregateProcessSteps,
  applyStreamDelta,
  buildChatEntries,
  fmtDurationMs,
  processGroupLabel,
  splitStreamThinking,
  type ChatEntry,
  type ProcessStep,
  type ToolStep,
} from "./messages";

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

function mkTool(toolName: string, over: Partial<ToolStep> = {}): ToolStep {
  return {
    toolName,
    status: "done",
    detail: "",
    target: "",
    resultPreview: "",
    elapsedSec: null,
    ...over,
  };
}

function asProcess(e: ChatEntry) {
  if (e.kind !== "turnProcess") throw new Error("not turnProcess");
  return e;
}

describe("buildChatEntries", () => {
  it("回合完成：工具收入 turnProcess（running=false），耗时由时间戳算出", () => {
    const entries = buildChatEntries([
      { role: "user", text: "hi", timestamp: 1000 },
      toolMsg({ timestamp: 1005 }),
      toolMsg({ tool_args: { command: "pwd" }, timestamp: 1010 }),
      { role: "assistant", text: "done", timestamp: 1012 },
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["user", "turnProcess", "assistant"]);
    const p = asProcess(entries[1]);
    expect(p.steps).toHaveLength(2);
    expect(p.running).toBe(false);
    // 最后一个过程步（tool@1010s）- user@1000s
    expect(p.durationMs).toBe(10_000);
  });

  it("尾部仍在累积的过程 = 回合进行中（running=true）", () => {
    const entries = buildChatEntries([{ role: "user", text: "hi" }, toolMsg({})]);
    expect(entries.map((e) => e.kind)).toEqual(["user", "turnProcess"]);
    expect(asProcess(entries[1]).running).toBe(true);
  });

  it("过程被 assistant 正文收尾，新工具另起一段", () => {
    const entries = buildChatEntries([
      toolMsg({}),
      { role: "assistant", text: "a" },
      toolMsg({}),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["turnProcess", "assistant", "turnProcess"]);
    expect(asProcess(entries[0]).running).toBe(false);
    expect(asProcess(entries[2]).running).toBe(true);
  });

  it("assistant 的 reasoning 收编为 thinking 步（含耗时计入）", () => {
    const entries = buildChatEntries([
      { role: "user", text: "hi", timestamp: 2000 },
      { role: "assistant", text: "ok", reasoning: "先看看目录", timestamp: 2010 },
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["user", "turnProcess", "assistant"]);
    const p = asProcess(entries[1]);
    expect(p.steps).toEqual([{ kind: "thinking", text: "先看看目录" }]);
    expect(p.durationMs).toBe(10_000);
    // assistant 正文不再携带 reasoning
    const a = entries[2];
    expect(a.kind === "assistant" && a.text).toBe("ok");
  });

  it("相邻 thinking 步合并为一段", () => {
    const entries = buildChatEntries([
      { role: "assistant", text: "", reasoning: "r1" },
      { role: "assistant", text: "done", reasoning: "r2" },
    ]);
    const p = asProcess(entries[0]);
    expect(p.steps).toEqual([{ kind: "thinking", text: "r1\nr2" }]);
  });

  it("user 与过程步同秒：耗时不显示（durationMs=null）", () => {
    const entries = buildChatEntries([
      { role: "user", text: "hi", timestamp: 1000 },
      toolMsg({ timestamp: 1000 }),
      { role: "assistant", text: "done", timestamp: 1000 },
    ]);
    const p = asProcess(entries[1]);
    expect(p.durationMs).toBeNull();
  });

  it("key 锚定过程首条消息下标（跨重建稳定）", () => {
    const entries = buildChatEntries([{ role: "user", text: "hi" }, toolMsg({})]);
    expect(asProcess(entries[1]).key).toBe("tp-1");
  });

  it("bash_exec 提取 command，读文件工具提取 target 路径", () => {
    const entries = buildChatEntries([
      toolMsg({}),
      toolMsg({ tool_name: "file_read", tool_args: { path: "/tmp/a" }, content: "" }),
    ]);
    const p = asProcess(entries[0]);
    const s0 = p.steps[0];
    const s1 = p.steps[1];
    expect(s0.kind === "tool" && s0.tool.detail).toBe("ls -la");
    expect(s1.kind === "tool" && s1.tool.target).toBe("/tmp/a");
  });

  it("error 状态、结果预览截断与单步耗时", () => {
    const entries = buildChatEntries([
      toolMsg({ tool_status: "error", content: "x".repeat(200), tool_elapsed_sec: 7 }),
    ]);
    const p = asProcess(entries[0]);
    const s = p.steps[0];
    if (s.kind !== "tool") throw new Error("not tool");
    expect(s.tool.status).toBe("error");
    expect(s.tool.resultPreview).toHaveLength(120);
    expect(s.tool.elapsedSec).toBe(7);
  });

  it("老消息（无 tool 字段）按纯文本回退不崩溃", () => {
    const entries = buildChatEntries([
      { role: "user", text: "u" },
      { role: "assistant", text: "a" },
      { role: "system", text: "s" },
      toolMsg({ tool_name: undefined, tool_args: undefined, content: undefined }),
    ]);
    expect(entries).toHaveLength(4);
    const p = asProcess(entries[3]);
    const s = p.steps[0];
    expect(s.kind === "tool" && s.tool.toolName).toBe("tool");
    expect(s.kind === "tool" && s.tool.detail).toBe("");
  });
});

describe("aggregateProcessSteps / processGroupLabel", () => {
  it("相邻同类工具聚合，异类与思考断组", () => {
    const steps: ProcessStep[] = [
      { kind: "tool", tool: mkTool("bash_exec") },
      { kind: "tool", tool: mkTool("bash_exec") },
      { kind: "tool", tool: mkTool("file_read") },
      { kind: "thinking", text: "t" },
    ];
    const groups = aggregateProcessSteps(steps);
    expect(groups.map((g) => g.steps.length)).toEqual([2, 1, 1]);
    expect(groups.map((g) => processGroupLabel(g))).toEqual([
      "执行 2 条命令",
      "读取 1 个文件",
      "思考过程",
    ]);
  });

  it("搜索/网页/兜底文案", () => {
    expect(
      processGroupLabel({
        kind: "tool",
        category: "search",
        steps: [{ kind: "tool", tool: mkTool("grep") }],
      }),
    ).toBe("搜索 1 次文件");
    expect(
      processGroupLabel({
        kind: "tool",
        category: "tool",
        steps: [
          { kind: "tool", tool: mkTool("mcp_xx") },
          { kind: "tool", tool: mkTool("mcp_xx") },
        ],
      }),
    ).toBe("使用 2 次 mcp_xx");
  });
});

describe("fmtDurationMs", () => {
  it("秒/分/小时分档", () => {
    expect(fmtDurationMs(5_000)).toBe("5秒");
    expect(fmtDurationMs(65_000)).toBe("1分5秒");
    expect(fmtDurationMs(120_000)).toBe("2分钟");
    expect(fmtDurationMs(3_720_000)).toBe("1小时2分");
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

describe("splitStreamThinking", () => {
  it("思考与正文分流（safe_stream 规范 think 标签）", () => {
    expect(splitStreamThinking("<think>想一下</think>答案是1")).toEqual({
      thinking: "想一下",
      visible: "答案是1",
    });
  });

  it("thinking 原文透传形态同样分流", () => {
    expect(splitStreamThinking("<thinking>想一下</thinking>答案是1")).toEqual({
      thinking: "想一下",
      visible: "答案是1",
    });
  });

  it("思考未闭合：全部归思考，正文为空", () => {
    expect(splitStreamThinking("<think>想")).toEqual({ thinking: "想", visible: "" });
    expect(splitStreamThinking("<thinking>想")).toEqual({ thinking: "想", visible: "" });
  });

  it("思考完成后出现正文，正文后再思考则续归思考", () => {
    expect(splitStreamThinking("<think>想一下</think>答<think>继续想")).toEqual({
      thinking: "想一下继续想",
      visible: "答",
    });
  });

  it("尾部被分片截断的开标签前缀暂扣一帧", () => {
    expect(splitStreamThinking("答案<t")).toEqual({ thinking: "", visible: "答案" });
    expect(splitStreamThinking("<")).toEqual({ thinking: "", visible: "" });
  });

  it("多轮思考块内容合并，正文段落保留", () => {
    const text = "<think>a</think>第一段<think>b</think>第二段";
    expect(splitStreamThinking(text)).toEqual({
      thinking: "ab",
      visible: "第一段第二段",
    });
  });
});
