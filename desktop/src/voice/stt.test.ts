import assert from "node:assert/strict";
import test from "node:test";

import { appendDictationText, parseTranscribeResponse, pickDictationMimeType, resolveSttBackend } from "./stt.ts";

test("appendDictationText appends with spacing", () => {
  assert.equal(appendDictationText("已有内容", "新的句子"), "已有内容 新的句子");
  assert.equal(appendDictationText("", "  你好  "), "你好");
  assert.equal(appendDictationText("仅原文", ""), "仅原文");
});

test("resolveSttBackend prefers server when api auth present", () => {
  assert.equal(resolveSttBackend({ apiBase: "http://127.0.0.1:8080", apiToken: "tok" }), "server");
  assert.equal(resolveSttBackend({ apiBase: "", apiToken: "tok" }), "browser");
  assert.equal(resolveSttBackend({ apiBase: "http://127.0.0.1:8080", apiToken: "" }), "browser");
});

test("parseTranscribeResponse extracts trimmed text", () => {
  assert.equal(parseTranscribeResponse({ text: "  hello  " }), "hello");
  assert.equal(parseTranscribeResponse({ ok: true }), "");
  assert.equal(parseTranscribeResponse(null), "");
});

test("pickDictationMimeType returns empty without MediaRecorder", () => {
  assert.equal(pickDictationMimeType(), "");
});
