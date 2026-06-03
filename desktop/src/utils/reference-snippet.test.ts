import test from "node:test";
import assert from "node:assert/strict";
import { formatReferenceSnippet } from "./reference-snippet";
import type { SearchReference } from "../types/search-references";

const kbRef = (snippet: string): SearchReference => ({
  id: 1,
  title: "doc.pdf",
  url: "agx://kb/doc1#0",
  snippet,
  source: "kb",
});

test("formatReferenceSnippet strips legacy score lines", () => {
  assert.equal(
    formatReferenceSnippet(kbRef("score=0.812 · fused=0.900\n实际正文摘录。")),
    "实际正文摘录。",
  );
});

test("formatReferenceSnippet returns plain chunk text unchanged", () => {
  assert.equal(formatReferenceSnippet(kbRef("企服AI价值公式说明。")), "企服AI价值公式说明。");
});

test("formatReferenceSnippet handles empty snippet", () => {
  assert.equal(formatReferenceSnippet(kbRef("")), "");
  assert.equal(formatReferenceSnippet(undefined), "");
});
