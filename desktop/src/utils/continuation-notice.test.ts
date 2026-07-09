import test from "node:test";
import assert from "node:assert/strict";
import {
  continuationNoticeKey,
  dedupeContinuationNotices,
  isContinuationNoticeMessage,
  maxContinuationRound,
  parseContinuationNotice,
} from "./continuation-notice";

test("parseContinuationNotice parses supervisor line", () => {
  const parsed = parseContinuationNotice({
    role: "tool",
    content: "🔁 无人值守续跑 · 原因：停滞 · 第 1 轮",
    metadata: { kind: "continuation_notice", source: "supervisor", reason: "stall", continuation_round: 1 },
  });
  assert.equal(parsed?.variant, "supervisor");
  assert.equal(parsed?.title, "无人值守续跑");
  assert.equal(parsed?.reason, "停滞");
  assert.equal(parsed?.round, 1);
});

test("dedupeContinuationNotices keeps last duplicate round", () => {
  const rows = [
    { role: "tool" as const, content: "🔁 无人值守续跑 · 原因：停滞 · 第 1 轮", metadata: { kind: "continuation_notice" } },
    { role: "user" as const, content: "hello", metadata: undefined },
    { role: "tool" as const, content: "🔁 无人值守续跑 · 原因：停滞 · 第 1 轮", metadata: { kind: "continuation_notice" } },
  ];
  const out = dedupeContinuationNotices(rows);
  assert.equal(out.length, 2);
  assert.equal(isContinuationNoticeMessage(out[1]!), true);
  assert.equal(continuationNoticeKey(out[1]!), continuationNoticeKey(rows[2]!));
});

test("maxContinuationRound uses metadata and legacy text", () => {
  const rows = [
    { role: "tool" as const, content: "🔁 无人值守续跑 · 原因：停滞 · 第 1 轮", metadata: { kind: "continuation_notice" } },
    {
      role: "tool" as const,
      content: "🔔 自动续跑提醒（第 2/5 次） · 原因：停滞",
      metadata: { kind: "continuation_notice", continuation_round: 4 },
    },
    { role: "user" as const, content: "hello", metadata: undefined },
  ];
  assert.equal(maxContinuationRound(rows), 4);
});
