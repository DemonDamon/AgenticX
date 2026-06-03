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

test("parseKbReferencesFromToolResult: metadata.document_id wins over source.uri path", () => {
  const refs = parseKbReferencesFromToolResult(
    JSON.stringify({
      ok: true,
      hits: [
        {
          id: "doc_abc123::000000",
          text: "chunk",
          source: {
            uri: "/tmp/uploads/report.pdf",
            title: "report.pdf",
            chunk_index: 1,
          },
          metadata: {
            document_id: "doc_abc123",
            source_path: "/tmp/uploads/report.pdf",
          },
        },
      ],
    }),
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "agx://kb/doc_abc123#1");
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
