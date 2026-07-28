import { describe, expect, it } from "vitest";
import { splitTextByAttachmentNames } from "./attachment-link";
import type { ChatMessageAttachment } from "@agenticx/core-api";

const docAttachment = (name: string): ChatMessageAttachment => ({
  name,
  mime_type: "text/markdown",
  kind: "document",
  parsed_text: "# hello",
  size: 19_840,
});

describe("splitTextByAttachmentNames", () => {
  it("splits filename into attachment link part", () => {
    const name = "微信公众号3000家组织定向采集技术方案.md";
    const parts = splitTextByAttachmentNames(`附件：${name}`, [docAttachment(name)]);
    expect(parts).toEqual([
      { type: "text", value: "附件：" },
      { type: "attachment", value: name, attachment: expect.objectContaining({ name }) },
    ]);
  });

  it("returns plain text when no attachments match", () => {
    expect(splitTextByAttachmentNames("hello", [docAttachment("other.md")])).toEqual([
      { type: "text", value: "hello" },
    ]);
  });
});
