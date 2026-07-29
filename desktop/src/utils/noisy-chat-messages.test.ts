import assert from "node:assert/strict";
import test from "node:test";
import {
  isEphemeralStopErrorText,
  isInterruptedAssistantPlaceholder,
  isNoisyToolStatusMessage,
} from "./noisy-chat-messages.ts";

test("isNoisyToolStatusMessage hides ephemeral interruption meta rows", () => {
  assert.equal(
    isNoisyToolStatusMessage({ role: "tool", content: "已中断任务", toolName: "" }),
    true,
  );
  assert.equal(
    isNoisyToolStatusMessage({ role: "tool", content: "已中断当前生成", toolName: "" }),
    true,
  );
  assert.equal(
    isNoisyToolStatusMessage({ role: "tool", content: "❌ 已中断当前生成", toolName: "" }),
    true,
    "SSE error rows with ❌ prefix are hidden",
  );
  assert.equal(
    isNoisyToolStatusMessage({ role: "tool", content: "已中断当前生成", toolName: "meta" }),
    true,
    "stop rows hide even when toolName is wrongly set",
  );
  assert.equal(
    isNoisyToolStatusMessage({ role: "tool", content: "file_read", toolName: "file_read" }),
    false,
  );
  assert.equal(
    isNoisyToolStatusMessage({ role: "tool", content: "✅ todo_write 结果: ok", toolName: "" }),
    true,
    "orphan formatted fallback rows are hidden",
  );
  assert.equal(
    isNoisyToolStatusMessage({
      role: "tool",
      content: "🗂 任务清单更新\n[>] a\n[ ] b\n(0/2 completed)",
      toolName: "todo_write",
    }),
    true,
    "todo_write snapshots are hidden (StickyTaskBar owns display)",
  );
  assert.equal(
    isNoisyToolStatusMessage({
      role: "tool",
      content: "🗂 任务清单更新\n[>] a\n[ ] b\n(0/2 completed)",
      toolName: "",
    }),
    true,
    "legacy todo snapshot prefix without toolName is hidden",
  );
});

test("isEphemeralStopErrorText matches runtime STOP_MESSAGE variants", () => {
  assert.equal(isEphemeralStopErrorText("已中断当前生成"), true);
  assert.equal(isEphemeralStopErrorText("❌ 已中断当前生成"), true);
  assert.equal(isEphemeralStopErrorText("Runtime error: timeout"), false);
});

test("isInterruptedAssistantPlaceholder hides barge-in assistant rows", () => {
  assert.equal(
    isInterruptedAssistantPlaceholder({ role: "assistant", content: "（已中断）" }),
    true,
  );
  assert.equal(
    isInterruptedAssistantPlaceholder({ role: "assistant", content: "正常回复" }),
    false,
  );
});
