import assert from "node:assert/strict";
import test from "node:test";

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

test("assistant text class only contributes the reasoning gap, no offset class", () => {
  assert.equal(getAssistantTextClassName({ hasReasoning: false }), undefined);
  assert.equal(getAssistantTextClassName({ hasReasoning: true }), "mt-2");
  assert.equal(getAssistantTextClassName({ hasReasoning: true, inReActRow: true }), "mt-2");
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
