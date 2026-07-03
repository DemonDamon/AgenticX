import test from "node:test";
import assert from "node:assert/strict";
import {
  HOOK_BLOCK_RE,
  buildHookBlockFriendlyNotice,
  findNearbyHookBlockedTool,
  isHookBlockEchoAssistantMessage,
  isHookBlockedToolMessage,
  stripHookBlockEchoWrappers,
} from "./hook-block-message";

test("HOOK_BLOCK_RE matches legacy bridge message", () => {
  assert.match("工具调用被 Hook 策略阻止。", HOOK_BLOCK_RE);
});

test("isHookBlockedToolMessage requires error or done status", () => {
  assert.equal(
    isHookBlockedToolMessage({ content: "工具调用被 Hook 策略阻止。", toolStatus: "error" }),
    true,
  );
  assert.equal(
    isHookBlockedToolMessage({ content: "工具调用被 Hook 策略阻止。", toolStatus: "running" }),
    false,
  );
});

test("stripHookBlockEchoWrappers removes tool-return wrappers", () => {
  const stripped = stripHookBlockEchoWrappers(
    "工具返回:\n\n```TEXT\n工具调用被 Hook 策略阻止。\n```",
  );
  assert.equal(stripped, "工具调用被 Hook 策略阻止。");

  const strippedOriginal = stripHookBlockEchoWrappers(
    "工具返回原样:\n\n```TEXT\n工具调用被 Hook 策略阻止。\n```",
  );
  assert.equal(strippedOriginal, "工具调用被 Hook 策略阻止。");
});

test("buildHookBlockFriendlyNotice uses nearby tool context", () => {
  const messages = [
    { role: "user" as const, content: "run it", toolStatus: undefined },
    {
      role: "tool" as const,
      content: "工具调用被 Hook 策略阻止。",
      toolStatus: "error" as const,
      toolName: "bash_exec",
      toolArgs: { command: "rm -rf /tmp/agx-hook-test-only" },
    },
    {
      role: "assistant" as const,
      content: "工具返回原样:\n```TEXT\n工具调用被 Hook 策略阻止。\n```",
    },
  ];
  assert.equal(
    isHookBlockEchoAssistantMessage(messages[2]),
    true,
  );
  const ctx = findNearbyHookBlockedTool(messages, 2);
  assert.equal(ctx?.toolName, "bash_exec");
  assert.match(
    buildHookBlockFriendlyNotice(ctx),
    /出于安全考虑，没有执行这条命令：rm -rf \/tmp\/agx-hook-test-only/,
  );
});

test("isHookBlockEchoAssistantMessage hides stiff echo replies", () => {
  assert.equal(
    isHookBlockEchoAssistantMessage({
      role: "assistant",
      content: "工具返回:\n\n```TEXT\n工具调用被 Hook 策略阻止。\n```",
    }),
    true,
  );
  assert.equal(
    isHookBlockEchoAssistantMessage({
      role: "assistant",
      content: "出于安全考虑，我没有执行删除命令，建议你改用更安全的方式清理临时目录。",
    }),
    false,
  );
});
