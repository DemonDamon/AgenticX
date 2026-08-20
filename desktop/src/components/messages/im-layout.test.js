import assert from "node:assert/strict";
import { test } from "vitest";

import {
  ASSISTANT_TIMELINE_PX,
  getAssistantActionOffsetClass,
  getAssistantActionStyle,
  getAssistantTextClassName,
  getAssistantTextStyle,
} from "./im-layout.ts";

test("assistant text style uses the configured visual rail", () => {
  const style = getAssistantTextStyle();
  assert.equal(style.paddingLeft, 2.5);
  assert.equal(ASSISTANT_TIMELINE_PX.textPaddingLeft, 2.5);
});

// 只给推理留出上间距，不再额外加缩进类（缩进走 style）。ReAct 行里间距收紧一档：
// 那一列本来就是紧排的，沿用 mt-2 会把整列撑散（见 35c8b7c0）。
test("assistant text class only contributes the reasoning gap, tighter inside a ReAct row", () => {
  assert.equal(getAssistantTextClassName({ hasReasoning: false }), undefined);
  assert.equal(getAssistantTextClassName({ hasReasoning: true }), "mt-2");
  assert.equal(getAssistantTextClassName({ hasReasoning: true, inReActRow: true }), "mt-1");
});

test("assistant action style uses the configured visual rail", () => {
  const style = getAssistantActionStyle();
  assert.equal(style.marginLeft, 12);
  assert.equal(ASSISTANT_TIMELINE_PX.actionMarginLeft, 12);
});

test("assistant action offset class is intentionally empty so style wins", () => {
  assert.equal(getAssistantActionOffsetClass(), "");
  assert.equal(getAssistantActionOffsetClass({ inReActRow: true }), "");
});
