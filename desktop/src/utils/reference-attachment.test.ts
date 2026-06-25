import test from "node:test";
import assert from "node:assert/strict";
import type { MessageAttachment } from "../store";
import {
  isReferenceMentionBoundary,
  matchReferenceMentionLabel,
} from "./reference-attachment";

const snippetRef = (overrides?: Partial<MessageAttachment>): MessageAttachment => ({
  name: "README.md",
  mimeType: "text/plain",
  size: 42,
  referenceToken: true,
  composerRefLabel: "README.md (224-224)",
  sourcePath: "/Users/demo/project/README.md",
  lineRange: { start: 224, end: 224 },
  ...overrides,
});

test("isReferenceMentionBoundary accepts CJK comma after mention", () => {
  assert.equal(isReferenceMentionBoundary("，你是"), true);
  assert.equal(isReferenceMentionBoundary(", next"), true);
  assert.equal(isReferenceMentionBoundary(" "), true);
  assert.equal(isReferenceMentionBoundary(""), true);
  assert.equal(isReferenceMentionBoundary("abc"), false);
});

test("matchReferenceMentionLabel matches README.md (224-224) before Chinese comma", () => {
  const refs = [snippetRef()];
  const rest = "README.md (224-224)，你是互联网搜索资料确认过的吗？";
  assert.equal(matchReferenceMentionLabel(rest, refs), "README.md (224-224)");
});

test("matchReferenceMentionLabel matches colon form before punctuation", () => {
  const refs = [
    snippetRef({
      composerRefLabel: "README.md:224-224",
      name: "/Users/demo/project/README.md:224-224",
    }),
  ];
  const rest = "README.md:224-224，确认";
  assert.equal(matchReferenceMentionLabel(rest, refs), "README.md:224-224");
});
