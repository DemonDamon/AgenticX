import assert from "node:assert/strict";
import test from "node:test";

import { filterPersistedMessagesForDeletion } from "./retry-trim-policy.ts";

test("重试裁剪：本地中断提示不在后端时应被过滤", () => {
  const pending = [
    {
      role: "assistant",
      content: "这是模型输出",
      timestamp: 1710000000000,
      agentId: "meta",
    },
    {
      role: "tool",
      content: "已发送中断请求",
      timestamp: 1710000001000,
      agentId: "meta",
    },
  ] as const;

  const persisted = [
    {
      role: "assistant",
      content: "这是模型输出",
      timestamp: 1710000000000,
      agent_id: "meta",
    },
  ] as const;

  const deletable = filterPersistedMessagesForDeletion(pending, persisted);
  assert.equal(deletable.length, 1);
  assert.equal(deletable[0]?.role, "assistant");
  assert.equal(deletable[0]?.content, "这是模型输出");
});

test("重试裁剪：重复消息按后端出现次数过滤", () => {
  const pending = [
    {
      role: "assistant",
      content: "重复片段",
      timestamp: 1710000010000,
      agentId: "meta",
    },
    {
      role: "assistant",
      content: "重复片段",
      timestamp: 1710000010000,
      agentId: "meta",
    },
  ] as const;

  const persisted = [
    {
      role: "assistant",
      content: "重复片段",
      timestamp: 1710000010000,
      agent_id: "meta",
    },
  ] as const;

  const deletable = filterPersistedMessagesForDeletion(pending, persisted);
  assert.equal(deletable.length, 1);
});
