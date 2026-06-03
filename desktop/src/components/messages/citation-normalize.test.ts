import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCitationMarkers,
  splitCitationSegments,
  stripOrphanCitationMarkers,
} from "./citation-normalize";

test("normalizeCitationMarkers: converts common variants when enabled", () => {
  assert.equal(
    normalizeCitationMarkers("事实【1】与(来源 2)及[来源3]", true),
    "事实[1]与[2]及[3]",
  );
});

test("normalizeCitationMarkers: no-op when disabled", () => {
  const input = "事实【1】";
  assert.equal(normalizeCitationMarkers(input, false), input);
});

test("splitCitationSegments: splits adjacent citations", () => {
  const segments = splitCitationSegments("功能[1][2]说明");
  assert.deepEqual(segments, [
    { kind: "text", value: "功能" },
    { kind: "citation", value: "1" },
    { kind: "citation", value: "2" },
    { kind: "text", value: "说明" },
  ]);
});

test("stripOrphanCitationMarkers: removes fabricated markers and tidies spacing", () => {
  assert.equal(
    stripOrphanCitationMarkers("调用统计等功能[1][2][3]，账户认证[4]。"),
    "调用统计等功能，账户认证。",
  );
});

test("stripOrphanCitationMarkers: strips normalized variants", () => {
  assert.equal(stripOrphanCitationMarkers("事实【1】与(来源 2)及[来源3]结束"), "事实与及结束");
});

test("stripOrphanCitationMarkers: preserves markdown links like [1](url)", () => {
  const input = "参见 [1](https://example.com) 与文末[2]";
  assert.equal(
    stripOrphanCitationMarkers(input),
    "参见 [1](https://example.com) 与文末",
  );
});
