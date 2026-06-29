import assert from "node:assert/strict";
import test from "node:test";
import {
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
    isNoisyToolStatusMessage({ role: "tool", content: "file_read", toolName: "file_read" }),
    false,
  );
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
