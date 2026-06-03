import test from "node:test";
import assert from "node:assert/strict";
import {
  accumulateReferenceTurn,
  parseKbReferencesFromToolResult,
} from "./search-reference-sse";

test("parseKbReferencesFromToolResult: builds refs from hits JSON", () => {
  const refs = parseKbReferencesFromToolResult(
    JSON.stringify({
      ok: true,
      hits: [
        {
          text: "网关能力说明",
          source: { uri: "doc1", title: "UToken.pdf", chunk_index: 2 },
        },
      ],
    }),
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].source, "kb");
  assert.equal(refs[0].url, "agx://kb/doc1#2");
  assert.equal(refs[0].snippet, "网关能力说明");
});

test("accumulateReferenceTurn: falls back to tool result when structured missing", () => {
  const { references } = accumulateReferenceTurn(
    [],
    [],
    {
      name: "knowledge_search",
      result: JSON.stringify({
        ok: true,
        hits: [{ text: "chunk", source: { uri: "x", title: "T" } }],
      }),
    },
    { query: "AI网关" },
  );
  assert.equal(references.length, 1);
  assert.equal(references[0].title, "T");
});
