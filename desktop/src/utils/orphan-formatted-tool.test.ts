import assert from "node:assert/strict";
import test from "node:test";

import {
  isOrphanFormattedToolResultMessage,
  isStreamToolLabelOnlyText,
  shouldSkipFormattedToolResultFallback,
} from "./orphan-formatted-tool.ts";
import { isNoisyToolStatusMessage } from "./noisy-chat-messages.ts";

test("isOrphanFormattedToolResultMessage detects SSE fallback rows without tool_call_id", () => {
  assert.equal(
    isOrphanFormattedToolResultMessage({
      role: "tool",
      content: "✅  结果:",
    }),
    true,
  );
  assert.equal(
    isOrphanFormattedToolResultMessage({
      role: "tool",
      content: "✅ web_search 结果: {}",
      toolCallId: "call-1",
    }),
    false,
  );
  assert.equal(
    isOrphanFormattedToolResultMessage({
      role: "tool",
      content: "🔧 web_search: {}",
    }),
    false,
    "legacy rows use a different prefix",
  );
});

test("isStreamToolLabelOnlyText blocks orphan assistant commits", () => {
  assert.equal(isStreamToolLabelOnlyText("结果："), true);
  assert.equal(isStreamToolLabelOnlyText("结果:"), true);
  assert.equal(isStreamToolLabelOnlyText("结果如下"), false);
});

test("shouldSkipFormattedToolResultFallback skips empty formatted summaries", () => {
  assert.equal(shouldSkipFormattedToolResultFallback("✅  结果:", ""), true);
  assert.equal(shouldSkipFormattedToolResultFallback("✅ web_search 结果: hits", "hits"), false);
});

test("isNoisyToolStatusMessage hides orphan formatted tool rows", () => {
  assert.equal(
    isNoisyToolStatusMessage({ role: "tool", content: "✅  结果:", toolName: "" }),
    true,
  );
  assert.equal(
    isNoisyToolStatusMessage({
      role: "tool",
      content: "{}",
      toolName: "web_search",
      toolCallId: "call-1",
    }),
    false,
  );
});
