import assert from "node:assert/strict";
import test from "node:test";

import {
  canStopCurrentRun,
  shouldInterruptOnResend,
} from "./streaming-stop-policy.ts";

test("停止按钮：单聊 streaming 中且会话匹配 → 可见", () => {
  assert.equal(
    canStopCurrentRun({
      streaming: true,
      streamingSessionId: "s-1",
      currentSessionId: "s-1",
    }),
    true,
  );
});

test("停止按钮：群聊 streaming 中且会话匹配 → 可见（不再排除群聊）", () => {
  // 历史 bug：ChatPane 用 `!isGroupPane && streaming` 导致群聊永远拿不到停止按钮。
  // 这里以与窗格类型无关的方式锁住"群聊也应可见"。
  assert.equal(
    canStopCurrentRun({
      streaming: true,
      streamingSessionId: "g-sse-1",
      currentSessionId: "g-sse-1",
    }),
    true,
  );
});

test("停止按钮：streaming=false → 不可见", () => {
  assert.equal(
    canStopCurrentRun({
      streaming: false,
      streamingSessionId: "s-1",
      currentSessionId: "s-1",
    }),
    false,
  );
});

test("停止按钮：streaming 中但会话不匹配（多窗格） → 不可见", () => {
  assert.equal(
    canStopCurrentRun({
      streaming: true,
      streamingSessionId: "s-1",
      currentSessionId: "s-2",
    }),
    false,
  );
});

test("停止按钮：streamingSessionId 空字符串 → 不可见（防御）", () => {
  assert.equal(
    canStopCurrentRun({
      streaming: true,
      streamingSessionId: "",
      currentSessionId: "s-1",
    }),
    false,
  );
});

test("停止按钮：会话 id 包含前后空格 → trim 后比较一致 → 可见", () => {
  assert.equal(
    canStopCurrentRun({
      streaming: true,
      streamingSessionId: "s-1",
      currentSessionId: "  s-1  ",
    }),
    true,
  );
});

test("追问策略：当前 session 有进行中的流 → 应打断当前并发新一轮", () => {
  assert.equal(
    shouldInterruptOnResend({ isStreamRunActive: true }),
    true,
  );
});

test("追问策略：当前 session 没有进行中的流 → 直接发送（不打断不入队）", () => {
  assert.equal(
    shouldInterruptOnResend({ isStreamRunActive: false }),
    false,
  );
});
