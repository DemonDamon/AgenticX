import assert from "node:assert/strict";
import { test } from "vitest";

import type { Message } from "../../store";
import {
  isToolGroupInProgress,
  shouldHoldToolGroupProgress,
  groupConsecutiveToolMessages,
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
