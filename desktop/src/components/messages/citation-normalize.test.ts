import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCitationRenderGroups,
  escapeMarkdownOrderedListMarkers,
  normalizeCitationMarkers,
  relocateCitationMarkersForDisplay,
  splitCitationParagraphBlocks,
  splitCitationSegments,
  stripOrphanCitationMarkers,
} from "./citation-normalize";

test("normalizeCitationMarkers: converts common variants when enabled", () => {
  assert.equal(
    normalizeCitationMarkers("事实【1】与(来源 2)及[来源3]", true),
    "事实[1]与[2]及[3]",
  );
});

test("normalizeCitationMarkers: converts circled numerals when enabled", () => {
  assert.equal(normalizeCitationMarkers("UToken①与AIBOX②", true), "UToken[1]与AIBOX[2]");
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

test("splitCitationParagraphBlocks: splits on blank lines only", () => {
  assert.deepEqual(
    splitCitationParagraphBlocks("条目[1]\n\n下一段"),
    ["条目[1]", "下一段"],
  );
});

test("stripOrphanCitationMarkers: preserves markdown links like [1](url)", () => {
  const input = "参见 [1](https://example.com) 与文末[2]";
  assert.equal(
    stripOrphanCitationMarkers(input),
    "参见 [1](https://example.com) 与文末",
  );
});

test("relocateCitationMarkersForDisplay: moves leading cite to previous line end", () => {
  assert.equal(
    relocateCitationMarkersForDisplay("1. UToken 网关产品 (PDF)\n[1]UCloud 推出的"),
    "1. UToken 网关产品 (PDF)[1]\nUCloud 推出的",
  );
});

test("relocateCitationMarkersForDisplay: moves cite-only line to previous line", () => {
  assert.equal(
    relocateCitationMarkersForDisplay("1. 标题行\n\n[1]\n\n正文"),
    "1. 标题行[1]\n\n\n正文",
  );
});

test("relocateCitationMarkersForDisplay: same-line leading cite goes to line end", () => {
  assert.equal(
    relocateCitationMarkersForDisplay("[1]单行说明"),
    "单行说明[1]",
  );
});

test("relocateCitationMarkersForDisplay: preserves markdown links at line start", () => {
  const input = "[1](https://example.com) 说明";
  assert.equal(relocateCitationMarkersForDisplay(input), input);
});

test("escapeMarkdownOrderedListMarkers: escapes line-start ordered list syntax", () => {
  assert.equal(
    escapeMarkdownOrderedListMarkers("1. UToken 网关\n正文"),
    "1\\. UToken 网关\n正文",
  );
});

test("buildCitationRenderGroups: keeps cite on title run before paragraph break", () => {
  const segments = splitCitationSegments("1. UToken 网关[1]\n\nUCloud 推出");
  assert.equal(segments.length, 3);
  const groups = buildCitationRenderGroups(segments);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2);
  assert.equal(groups[0][0].kind, "text");
  assert.equal(groups[0][1].kind, "citation");
  assert.equal(groups[1][0].value.startsWith("\n"), true);
});

test("buildCitationRenderGroups: mid-sentence cites stay in one group", () => {
  const groups = buildCitationRenderGroups(splitCitationSegments("功能[1][2]说明"));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 4);
});
