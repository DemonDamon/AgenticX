import { describe, expect, it } from "vitest";
import type { Message } from "../../store";
import type { GroupedChatRow } from "./group-tool-messages";
import { parkTrailingReasoningInProcess, resolveProcessFoldRange } from "./react-work-fold";

function assistantRow(id: string): GroupedChatRow {
  return { kind: "message", message: { id, role: "assistant", content: id } as Message };
}

function reasoningRow(id: string): GroupedChatRow {
  return {
    kind: "message",
    message: { id, role: "assistant", content: "", reasoning: id } as Message,
  };
}

function toolRow(id: string): GroupedChatRow {
  return {
    kind: "tool_group",
    groupId: id,
    messages: [{ id, role: "tool", content: "{}", toolName: "tool_search" } as Message],
  };
}

describe("resolveProcessFoldRange", () => {
  it("keeps prose written before the first tool call out of the fold", () => {
    // 实测回归：模型答完「延迟加载工具怎么触发」之后顺手演示了一次 tool_search，
    // 正文在前、工具在后。折叠从 0 起时正文整段被折走，用户只看到收尾那一句。
    const rows = [assistantRow("body"), toolRow("tool_search")];
    expect(resolveProcessFoldRange(rows)).toEqual({ start: 1, end: 2 });
  });

  it("folds nothing when the block has no tool activity at all", () => {
    const rows = [assistantRow("a"), assistantRow("b")];
    expect(resolveProcessFoldRange(rows)).toEqual({ start: 0, end: 0 });
  });

  it("spans from the first tool group to the last, narration in between included", () => {
    const rows = [
      assistantRow("intro"),
      toolRow("t1"),
      assistantRow("mid"),
      toolRow("t2"),
      assistantRow("final"),
    ];
    expect(resolveProcessFoldRange(rows)).toEqual({ start: 1, end: 4 });
  });

  it("leaves the trailing answer outside the fold", () => {
    const rows = [toolRow("t1"), assistantRow("answer")];
    const { start, end } = resolveProcessFoldRange(rows);
    expect(rows.slice(end)).toEqual([assistantRow("answer")]);
    expect(start).toBe(0);
  });

  it("folds think-only rows that sit between the last tool and the answer", () => {
    const rows = [toolRow("t1"), reasoningRow("later"), assistantRow("answer")];
    expect(resolveProcessFoldRange(rows)).toEqual({ start: 0, end: 2 });
  });
});

describe("parkTrailingReasoningInProcess", () => {
  it("moves think-only rows that landed after the answer back into the process span", () => {
    const rows = [toolRow("t1"), assistantRow("answer"), reasoningRow("a"), reasoningRow("b")];
    const parked = parkTrailingReasoningInProcess(rows);
    expect(parked.map((row) => (row.kind === "message" ? row.message.id : row.groupId))).toEqual([
      "t1",
      "a",
      "b",
      "answer",
    ]);
    const { end } = resolveProcessFoldRange(parked);
    expect(parked.slice(end).map((row) => (row.kind === "message" ? row.message.id : row.groupId))).toEqual([
      "answer",
    ]);
  });

  it("leaves a block alone when thoughts already precede the answer", () => {
    const rows = [toolRow("t1"), reasoningRow("mid"), assistantRow("answer")];
    expect(parkTrailingReasoningInProcess(rows)).toEqual(rows);
  });
});
