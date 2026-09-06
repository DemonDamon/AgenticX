import { describe, expect, it } from "vitest";
import { officePreviewKind, officePreviewMime } from "./office-preview-kind";

describe("officePreviewKind", () => {
  it("routes modern Office files to the matching preview", () => {
    expect(officePreviewKind("/tmp/a.docx")).toBe("docx");
    expect(officePreviewKind("/tmp/a.xlsx")).toBe("xlsx");
    expect(officePreviewKind("/Desktop/UToken网关产品-内部分享-20260417.pptx")).toBe("pptx");
  });

  it("keeps legacy binary PowerPoint on the fallback path", () => {
    expect(officePreviewKind("/tmp/deck.ppt")).toBe("other");
  });

  it("does not treat nearby extensions as PowerPoint", () => {
    expect(officePreviewKind("/tmp/notes.txt")).toBe("other");
    expect(officePreviewKind("/tmp/deck.pptx.bak")).toBe("other");
  });
});

describe("officePreviewMime", () => {
  it("uses the OOXML presentation MIME for pptx", () => {
    expect(officePreviewMime("share.pptx")).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });
});

describe("@aiden0z/pptx-renderer", () => {
  it("exports PptxViewer.open", async () => {
    const { PptxViewer } = await import("@aiden0z/pptx-renderer");
    expect(typeof PptxViewer.open).toBe("function");
  });
});
