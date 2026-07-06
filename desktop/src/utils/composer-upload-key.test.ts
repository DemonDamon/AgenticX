import test from "node:test";
import assert from "node:assert/strict";
import type { MessageAttachment } from "../store";
import {
  isComposerUploadDedupeKey,
  isMisclassifiedUploadReference,
  stripComposerUploadDedupeKey,
} from "./composer-upload-key";
import { isWorkspaceReferenceAttachment } from "./reference-attachment";
import { attachmentsFromSessionRow } from "./session-message-map";

test("isComposerUploadDedupeKey detects name:size:lastModified", () => {
  const key = "notes.txt:32506:1783310868057";
  assert.equal(isComposerUploadDedupeKey(key), true);
  assert.equal(stripComposerUploadDedupeKey(key), "notes.txt");
});

test("isComposerUploadDedupeKey rejects workspace line-range keys", () => {
  assert.equal(isComposerUploadDedupeKey("/tmp/README.md:224-224"), false);
  assert.equal(isComposerUploadDedupeKey("/Users/demo/a.txt:10-20"), false);
});

test("isMisclassifiedUploadReference detects polluted persisted rows", () => {
  const polluted: MessageAttachment = {
    name: "07月06日 11时05分_Transcript.txt",
    mimeType: "text/plain",
    size: 32506,
    referenceToken: true,
    composerRefLabel: "07月06日 11时05分_Transcript.txt (32506-1783310868057)",
    sourcePath: "07月06日 11时05分_Transcript.txt",
    lineRange: { start: 32506, end: 1783310868057 },
  };
  assert.equal(isMisclassifiedUploadReference(polluted), true);
  assert.equal(isWorkspaceReferenceAttachment(polluted), false);
});

test("attachmentsFromSessionRow reloads polluted upload as AttachmentCard row", () => {
  const atts = attachmentsFromSessionRow([
    {
      name: "07月06日 11时05分_Transcript.txt",
      mime_type: "text/plain",
      size: 32506,
      source_path: "07月06日 11时05分_Transcript.txt",
      reference_token: true,
      composer_ref_label: "07月06日 11时05分_Transcript.txt (32506-1783310868057)",
      kind: "context_file",
      line_start: 32506,
      line_end: 1783310868057,
    },
  ]);
  assert.equal(atts?.length, 1);
  assert.equal(atts?.[0]?.referenceToken, undefined);
  assert.equal(atts?.[0]?.lineRange, undefined);
  assert.equal(isWorkspaceReferenceAttachment(atts![0]!), false);
});
