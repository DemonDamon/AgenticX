import test from "node:test";
import assert from "node:assert/strict";
import type { MessageAttachment } from "../store";
import {
  canonicalizeUserReferenceMentions,
  isReferenceMentionBoundary,
  matchReferenceMentionLabel,
  stableAttachmentSetKey,
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

test("canonicalizeUserReferenceMentions aligns composer labels with persisted paths", () => {
  const refs = [snippetRef()];
  const text = "检查 @README.md (224-224)，再使用 @skill://review";
  assert.equal(
    canonicalizeUserReferenceMentions(text, refs),
    "检查 @/Users/demo/project/README.md:224-224，再使用 @skill://review",
  );
});

test("canonicalizeUserReferenceMentions keeps canonical persisted paths unchanged", () => {
  const refs = [snippetRef()];
  const text = "检查 @/Users/demo/project/README.md:224-224";
  assert.equal(canonicalizeUserReferenceMentions(text, refs), text);
});

test("canonicalizeUserReferenceMentions never treats a skill token as a file label", () => {
  const refs = [
    snippetRef({
      name: "skill",
      composerRefLabel: "skill",
      sourcePath: "/Users/demo/project/skill",
      lineRange: undefined,
    }),
  ];
  const text = "使用 @skill://review";
  assert.equal(canonicalizeUserReferenceMentions(text, refs), text);
});

test("matchReferenceMentionLabel matches HTML element tag with Trae comment meta", () => {
  const refs: MessageAttachment[] = [
    {
      name: "/tmp/report/index.html:el-snippet-fe67ada8",
      mimeType: "text/plain",
      size: 100,
      referenceToken: true,
      composerRefLabel: "span",
      sourcePath: "/tmp/report/index.html",
      snippetRef: "el-snippet-fe67ada8",
      htmlElementRef: {
        tagName: "span",
        selectorHint: "span.risk",
        comment: "这个对吗",
      },
    },
  ];
  assert.equal(matchReferenceMentionLabel("span", refs), "span");
  assert.equal(
    canonicalizeUserReferenceMentions("@span", refs),
    "@/tmp/report/index.html:el-snippet-fe67ada8",
  );
});

test("canonicalizeUserReferenceMentions resolves repeated same-name labels by attachment order", () => {
  const refs = [
    snippetRef({
      name: "context.md",
      composerRefLabel: "context.md",
      sourcePath: "/Users/demo/project-a/context.md",
      lineRange: undefined,
    }),
    snippetRef({
      name: "context.md",
      composerRefLabel: "context.md",
      sourcePath: "/Users/demo/project-b/context.md",
      lineRange: undefined,
    }),
  ];
  assert.equal(
    canonicalizeUserReferenceMentions("比较 @context.md 和 @context.md", refs),
    "比较 @/Users/demo/project-a/context.md 和 @/Users/demo/project-b/context.md",
  );
});

test("stableAttachmentSetKey ignores upload/reference classification for the same source", () => {
  const path = "/Users/demo/project/manual.pdf";
  const upload: MessageAttachment = {
    name: "manual.pdf",
    mimeType: "application/pdf",
    size: 100,
    sourcePath: path,
  };
  const persistedReference: MessageAttachment = {
    ...upload,
    size: 98,
    referenceToken: true,
    composerRefLabel: "manual.pdf",
  };
  assert.equal(
    stableAttachmentSetKey([upload]),
    stableAttachmentSetKey([persistedReference]),
  );
});

test("stableAttachmentSetKey resolves a directory alias to its persisted source path", () => {
  const path = "/Users/demo/project/docs";
  const composerDirectory: MessageAttachment = {
    name: `@dir:文档:${path}`,
    mimeType: "text/plain",
    size: 200,
    referenceToken: true,
    composerRefLabel: "文档",
  };
  const persistedDirectory: MessageAttachment = {
    name: `@dir:文档:${path}`,
    mimeType: "text/plain",
    size: 198,
    sourcePath: path,
    referenceToken: true,
    composerRefLabel: "文档",
  };
  assert.equal(
    stableAttachmentSetKey([composerDirectory]),
    stableAttachmentSetKey([persistedDirectory]),
  );
});
