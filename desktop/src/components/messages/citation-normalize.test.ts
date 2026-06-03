import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCitationRenderGroups,
  escapeMarkdownOrderedListMarkers,
  mergeAdjacentCitations,
  normalizeCitationMarkers,
  relocateCitationMarkersForDisplay,
  containsGfmTable,
  splitCitationParagraphBlocks,
  splitCitationSegments,
  splitCitationSegmentsRespectingTables,
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

test("mergeAdjacentCitations: merges adjacent same-document numbers, keeps text", () => {
  // ids 4,5 both map to document number 3; ids 1,2 are docs 1,2.
  const docMap = new Map<number, number>([
    [1, 1],
    [2, 2],
    [4, 3],
    [5, 3],
  ]);
  const items = mergeAdjacentCitations(splitCitationSegments("功能[4][5]说明[1]"), docMap);
  assert.deepEqual(items, [
    { kind: "text", value: "功能" },
    { kind: "citation", docNumber: 3, ids: [4, 5] },
    { kind: "text", value: "说明" },
    { kind: "citation", docNumber: 1, ids: [1] },
  ]);
});

test("mergeAdjacentCitations: non-adjacent same document stays separate", () => {
  const docMap = new Map<number, number>([
    [3, 3],
    [4, 3],
  ]);
  const items = mergeAdjacentCitations(splitCitationSegments("甲[3]乙[4]"), docMap);
  assert.deepEqual(items, [
    { kind: "text", value: "甲" },
    { kind: "citation", docNumber: 3, ids: [3] },
    { kind: "text", value: "乙" },
    { kind: "citation", docNumber: 3, ids: [4] },
  ]);
});

test("mergeAdjacentCitations: missing id falls back to raw number", () => {
  const items = mergeAdjacentCitations(splitCitationSegments("X[7]"), new Map());
  assert.deepEqual(items, [
    { kind: "text", value: "X" },
    { kind: "citation", docNumber: 7, ids: [7] },
  ]);
});

test("buildCitationRenderGroups: h3 title cite then body splits into two groups", () => {
  const block = "### 1. **UToken 网关产品（UCloud）** [1]  \n面向企业 Token";
  const groups = buildCitationRenderGroups(splitCitationSegments(block));
  assert.equal(groups.length, 2);
  assert.equal(groups[0][groups[0].length - 1].kind, "citation");
  assert.match(groups[1][0].value, /面向企业 Token/);
});

test("splitCitationSegmentsRespectingTables: keeps GFM table as one segment", () => {
  const table =
    "| 产品 | 部门 |\n| --- | --- |\n| NewAPI [2] [3] | 支持多用户 |\n| LiteLLM [4] [5] | Team |";
  const segments = splitCitationSegmentsRespectingTables(table);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].kind, "text");
  assert.match(segments[0].value, /NewAPI \[2\] \[3\]/);
  assert.match(segments[0].value, /LiteLLM \[4\] \[5\]/);
});

test("splitCitationSegmentsRespectingTables: splits prose cites outside table", () => {
  const input = "说明[1]\n\n| A [2] | B |\n| --- | --- |\n| C | D |";
  const segments = splitCitationSegmentsRespectingTables(input);
  assert.deepEqual(
    segments.filter((s) => s.kind === "citation").map((s) => s.value),
    ["1"],
  );
  assert.equal(segments.some((s) => s.kind === "text" && s.value === "说明"), true);
  const tableSeg = segments.find((s) => s.kind === "text" && containsGfmTable(s.value));
  assert.ok(tableSeg);
  assert.match(tableSeg!.value, /\| A \[2\] \| B \|/);
});

test("containsGfmTable: detects pipe tables", () => {
  assert.equal(containsGfmTable("| a | b |\n| --- | --- |"), true);
  assert.equal(containsGfmTable("单行 | 不是表格 |"), false);
});
