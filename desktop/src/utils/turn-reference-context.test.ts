import test from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../store";
import {
  resolveReferencesForAssistant,
  tryParseEmbeddedKbSearchJson,
} from "./turn-reference-context";

test("tryParseEmbeddedKbSearchJson: reads fenced JSON", () => {
  const refs = tryParseEmbeddedKbSearchJson(
    '已调用工具\n```json\n{"ok":true,"hits":[{"text":"gw","source":{"uri":"d","title":"T"}}]}\n```',
  );
  assert.equal(refs.length, 1);
  assert.equal(refs[0].title, "T");
});

test("resolveReferencesForAssistant: inherits from preceding tool row", () => {
  const toolJson = JSON.stringify({
    ok: true,
    hits: [{ text: "chunk", source: { uri: "doc", title: "Doc" } }],
  });
  const messages: Message[] = [
    { id: "u1", role: "user", content: "q" },
    { id: "t1", role: "tool", content: toolJson, toolName: "knowledge_search" },
    { id: "a1", role: "assistant", content: "回答[1]" },
  ];
  const refs = resolveReferencesForAssistant(messages[2], messages);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].source, "kb");
});
