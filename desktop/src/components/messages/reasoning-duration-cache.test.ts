import assert from "node:assert/strict";
import test from "node:test";
import {
  formatReasoningTitle,
  getCachedReasoningDuration,
  measureReasoningSeconds,
  setCachedReasoningDuration,
} from "./reasoning-duration-cache";

test("formatReasoningTitle uses Chinese labels", () => {
  assert.equal(
    formatReasoningTitle({ streaming: true, elapsedSeconds: 3, hasReliableDuration: true }),
    "思考中（3 秒）",
  );
  assert.equal(
    formatReasoningTitle({ streaming: false, elapsedSeconds: 5, hasReliableDuration: true }),
    "思考了 5 秒",
  );
  assert.equal(
    formatReasoningTitle({ streaming: false, elapsedSeconds: 0, hasReliableDuration: false }),
    "思考过程",
  );
});

test("reasoning duration cache survives remount key lookup", () => {
  const text = "先搜索再汇总";
  setCachedReasoningDuration(text, 4);
  assert.equal(getCachedReasoningDuration(text), 4);
});

test("measureReasoningSeconds rounds up to at least one second", () => {
  assert.equal(measureReasoningSeconds(0, 400), 1);
  assert.equal(measureReasoningSeconds(0, 2600), 3);
});
