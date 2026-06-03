import test from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../store";
import { enrichDiskMessagesWithInMemoryReferences } from "./session-reference-reconcile";

test("enrichDiskMessagesWithInMemoryReferences: copies refs when disk lags", () => {
  const refs = [
    {
      id: 1,
      title: "Doc",
      url: "agx://kb/doc1",
      snippet: "snippet",
      source: "kb" as const,
    },
  ];
  const current: Message[] = [
    {
      id: "a1",
      role: "assistant",
      content: "回答正文",
      references: refs,
    },
  ];
  const disk: Message[] = [
    {
      id: "disk-1",
      role: "assistant",
      content: "回答正文",
    },
  ];
  const out = enrichDiskMessagesWithInMemoryReferences(current, disk);
  assert.equal(out[0].references?.length, 1);
  assert.equal(out[0].references?.[0].title, "Doc");
});
