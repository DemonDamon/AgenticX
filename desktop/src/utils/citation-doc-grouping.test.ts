import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDocNumberMap,
  deriveDocKey,
  dedupeReferencesByDoc,
} from "./citation-doc-grouping";
import type { SearchReference } from "../types/search-references";

function kb(id: number, docId: string, chunk: number, title = "Doc"): SearchReference {
  return {
    id,
    title,
    url: `agx://kb/${docId}#${chunk}`,
    snippet: `chunk ${chunk}`,
    source: "kb",
  };
}

function web(id: number, url: string, title = url): SearchReference {
  return { id, title, url, snippet: "", source: "web" };
}

test("deriveDocKey: kb strips chunk suffix", () => {
  assert.equal(deriveDocKey(kb(1, "doc_abc", 3)), "agx://kb/doc_abc");
});

test("deriveDocKey: web uses url", () => {
  assert.equal(deriveDocKey(web(1, "https://a.com/x")), "https://a.com/x");
});

test("buildDocNumberMap: a/b single chunk, c three chunks share one number", () => {
  const refs = [
    kb(1, "doc_a", 0, "a.md"),
    kb(2, "doc_b", 0, "b.md"),
    kb(3, "doc_c", 0, "c.md"),
    kb(4, "doc_c", 1, "c.md"),
    kb(5, "doc_c", 2, "c.md"),
  ];
  const map = buildDocNumberMap(refs);
  assert.equal(map.get(1), 1);
  assert.equal(map.get(2), 2);
  assert.equal(map.get(3), 3);
  assert.equal(map.get(4), 3);
  assert.equal(map.get(5), 3);
});

test("buildDocNumberMap: web results stay distinct and match ids", () => {
  const refs = [web(1, "https://a.com"), web(2, "https://b.com")];
  const map = buildDocNumberMap(refs);
  assert.equal(map.get(1), 1);
  assert.equal(map.get(2), 2);
});

test("dedupeReferencesByDoc: collapses c chunks into one group with 3 chunks", () => {
  const refs = [
    kb(1, "doc_a", 0, "a.md"),
    kb(2, "doc_b", 0, "b.md"),
    kb(3, "doc_c", 0, "c.md"),
    kb(4, "doc_c", 1, "c.md"),
    kb(5, "doc_c", 2, "c.md"),
  ];
  const groups = dedupeReferencesByDoc(refs);
  assert.equal(groups.length, 3);
  assert.equal(groups[2].docNumber, 3);
  assert.equal(groups[2].chunks.length, 3);
  assert.equal(groups[0].primary.title, "a.md");
});
