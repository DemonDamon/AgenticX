import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "../../store";
import {
  isToolGroupInProgress,
  shouldHoldToolGroupProgress,
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
