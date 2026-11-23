import assert from "node:assert/strict";
import { test } from "vitest";

import type { Message } from "../../store";
import {
  isToolGroupCancelled,
  isToolGroupInProgress,
  shouldHoldToolGroupProgress,
  groupConsecutiveToolMessages,
  hoistTrailingToolGroups,
} from "./group-tool-messages";

function toolMessage(
  id: string,
  status: Message["toolStatus"],
  toolName = "web_search",
): Message {
  return {
    id,
    role: "tool",
    content: "{}",
    toolCallId: id,
    toolName,
    toolStatus: status,
    toolGroupId: "group-1",
  };
}

test("isToolGroupInProgress is true while any tool row is running", () => {
  assert.equal(
    isToolGroupInProgress([
      toolMessage("t1", "done"),
      toolMessage("t2", "running"),
    ]),
    true,
  );
});

test("isToolGroupCancelled is true only after in-flight rows are cancelled", () => {
  assert.equal(
    isToolGroupCancelled([
      toolMessage("t1", "done"),
      toolMessage("t2", "running"),
    ]),
    false,
  );
  assert.equal(
    isToolGroupCancelled([
      toolMessage("t1", "done"),
      toolMessage("t2", "cancelled"),
    ]),
    true,
  );
  assert.equal(isToolGroupCancelled([toolMessage("t1", "done")]), false);
});

test("shouldHoldToolGroupProgress bridges the gap between sequential tool calls", () => {
  const group = [toolMessage("t1", "done"), toolMessage("t2", "done")];
  const context = [...group];

  assert.equal(shouldHoldToolGroupProgress(context, group, true), true);
});

test("shouldHoldToolGroupProgress stops once assistant output starts", () => {
  const group = [toolMessage("t1", "done"), toolMessage("t2", "done")];
  const context: Message[] = [
    ...group,
    { id: "__stream__", role: "assistant", content: "结果如下" },
  ];

  assert.equal(shouldHoldToolGroupProgress(context, group, true), false);
});

test("shouldHoldToolGroupProgress ignores historical tool groups", () => {
  const oldGroup = [toolMessage("old", "done")];
  const currentGroup = [toolMessage("t1", "done")];
  const context = [...oldGroup, { id: "u1", role: "user", content: "继续" }, ...currentGroup];

  assert.equal(shouldHoldToolGroupProgress(context, oldGroup, true), false);
  assert.equal(shouldHoldToolGroupProgress(context, currentGroup, true), true);
});

test("actionConfirmation tool rows stay ungrouped", () => {
  const actionRow: Message = {
    ...toolMessage("confirm-1", "running", "request_action_confirmation"),
    actionConfirmation: {
      requestId: "req-1",
      sessionId: "sess-1",
      agentId: "meta",
      title: "确认发送？",
      summary: [],
      approveLabel: "确认执行",
      rejectLabel: "取消",
      status: "pending",
    },
  };
  const rows = groupConsecutiveToolMessages([
    toolMessage("t1", "done"),
    actionRow,
    toolMessage("t2", "done"),
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1]?.kind, "message");
  if (rows[1]?.kind === "message") {
    assert.equal(rows[1].message.id, "confirm-1");
  }
});

test("Jev decision cards stay ungrouped", () => {
  const jevRow: Message = {
    ...toolMessage("jev-1", "done", "jev"),
    metadata: { kind: "jev_decision", source: "jev" },
  };
  const rows = groupConsecutiveToolMessages([
    toolMessage("t1", "done"),
    jevRow,
    toolMessage("t2", "done"),
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1]?.kind, "message");
});

test("Plan artifact tools stay ungrouped for the standalone Plan card", () => {
  const rows = groupConsecutiveToolMessages([
    toolMessage("t1", "done"),
    toolMessage("plan", "done", "plan_create"),
    toolMessage("t2", "done"),
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[1]?.kind, "message");
});

test("in-progress show_widget placeholder is dropped when a later widget exists", () => {
  const firstPlaceholder = toolMessage("w1", "running", "show_widget");
  const retryPlaceholder = {
    ...toolMessage("w2", "running", "show_widget"),
    toolArgs: { title: "Claude Code 兼容 AGENTS.md" },
  };
  const rows = groupConsecutiveToolMessages([
    { id: "u1", role: "user", content: "看图" },
    firstPlaceholder,
    retryPlaceholder,
  ]);
  const widgetIds = rows
    .filter((row) => row.kind === "message")
    .map((row) => row.message.id);
  assert.deepEqual(widgetIds, ["u1", "w2"]);
});

test("finished show_widget stays when a later widget starts", () => {
  const finished: Message = {
    ...toolMessage("w1", "done", "show_widget"),
    content: JSON.stringify({ type: "widget", title: "图一", widget_code: "<svg></svg>" }),
  };
  const nextPlaceholder = toolMessage("w2", "running", "show_widget");
  const rows = groupConsecutiveToolMessages([
    { id: "u1", role: "user", content: "再画一张" },
    finished,
    nextPlaceholder,
  ]);
  const widgetIds = rows
    .filter((row) => row.kind === "message")
    .map((row) => row.message.id);
  assert.deepEqual(widgetIds, ["u1", "w1", "w2"]);
});

test("auto-approve confirm receipts are dropped from grouped chat rows", () => {
  const receipt: Message = {
    id: "receipt-1",
    role: "tool",
    content: "程基岩：确认通过，继续执行",
    agentId: "cheng",
  };
  const rows = groupConsecutiveToolMessages([
    { id: "u1", role: "user", content: "继续" },
    receipt,
    { id: "a1", role: "assistant", content: "FINAL" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.kind, "message");
  assert.equal(rows[1]?.kind, "message");
  if (rows[0]?.kind === "message") assert.equal(rows[0].message.id, "u1");
  if (rows[1]?.kind === "message") assert.equal(rows[1].message.id, "a1");
});

function assistantMessage(id: string, content: string): Message {
  return { id, role: "assistant", content };
}

test("groupConsecutiveToolMessages hoists late tool rows above the answer", () => {
  const rows = groupConsecutiveToolMessages([
    { id: "u1", role: "user", content: "搜新闻" },
    assistantMessage("a1", "以下是最近一周的主要新闻"),
    toolMessage("t1", "done", "mcp__bocha-search-mcp__web_search"),
  ]);
  assert.equal(rows.map((row) => row.kind).join(","), "message,tool_group,message");
  if (rows[0]?.kind === "message") assert.equal(rows[0].message.id, "u1");
  if (rows[1]?.kind === "tool_group") assert.equal(rows[1].messages[0]?.id, "t1");
  if (rows[2]?.kind === "message") assert.equal(rows[2].message.id, "a1");
});

test("hoistTrailingToolGroups keeps interleaved preamble tools and answer", () => {
  const rows = hoistTrailingToolGroups([
    { kind: "message", message: assistantMessage("preamble", "我先搜一下") },
    {
      kind: "tool_group",
      groupId: "g1",
      messages: [toolMessage("t1", "done")],
    },
    { kind: "message", message: assistantMessage("answer", "结果如下") },
  ]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "message" ? row.message.id : row.groupId)),
    ["preamble", "g1", "answer"],
  );
});

test("hoistTrailingToolGroups does not move tools followed by live stream text", () => {
  const rows = hoistTrailingToolGroups([
    { kind: "message", message: assistantMessage("a1", "已提交的答案") },
    {
      kind: "tool_group",
      groupId: "g1",
      messages: [toolMessage("t1", "done")],
    },
    { kind: "message", message: { id: "__stream__", role: "assistant", content: "继续输出" } },
  ]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "message" ? row.message.id : row.groupId)),
    ["a1", "g1", "__stream__"],
  );
});

test("hoistTrailingToolGroups parks trailing tools before the last committed answer", () => {
  const rows = hoistTrailingToolGroups([
    { kind: "message", message: { id: "think", role: "assistant", content: "", reasoning: "思考" } },
    { kind: "message", message: assistantMessage("a1", "总结如下") },
    {
      kind: "tool_group",
      groupId: "g1",
      messages: [toolMessage("t1", "done")],
    },
  ]);
  assert.deepEqual(
    rows.map((row) => (row.kind === "message" ? row.message.id : row.groupId)),
    ["think", "g1", "a1"],
  );
});
