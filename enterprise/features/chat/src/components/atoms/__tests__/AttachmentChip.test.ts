import { describe, expect, it } from "vitest";
import type { ComposerAttachment } from "../../../types/composer-attachment";
import { attachmentChipStatusLabel } from "../AttachmentChip";

function base(partial: Partial<ComposerAttachment> & Pick<ComposerAttachment, "status">): ComposerAttachment {
  return {
    id: "01TESTATTACHMENTCHIP000001",
    name: "a.pdf",
    mimeType: "application/pdf",
    size: 15_925_248,
    kind: "document",
    ...partial,
  };
}

describe("attachmentChipStatusLabel", () => {
  it("shows upload percent while uploading", () => {
    expect(attachmentChipStatusLabel(base({ status: "uploading", uploadProgress: 23 }))).toBe("23%");
  });

  it("shows waiting-for-parse while parsing", () => {
    expect(attachmentChipStatusLabel(base({ status: "parsing" }))).toBe("等待解析");
  });

  it("shows type and size when ready", () => {
    expect(attachmentChipStatusLabel(base({ status: "ready" }))).toBe("PDF 15.19 MB");
  });
});
