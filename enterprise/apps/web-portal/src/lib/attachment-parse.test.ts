import { describe, expect, it, vi } from "vitest";
import { parseAttachmentFile } from "./attachment-parse";
import JSZip from "jszip";

describe("parseAttachmentFile", () => {
  it("extracts text from a simple csv-like xlsx buffer via sheetjs", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["产品", "数量"],
      ["Near", 1],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

    const parsed = await parseAttachmentFile({
      name: "demo.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });

    expect(parsed.kind).toBe("document");
    expect(parsed.parsedText).toContain("Near");
    expect(parsed.parsedText).toContain("产品");
  });

  it("returns video parse text (filename at minimum)", async () => {
    const parsed = await parseAttachmentFile(
      {
        name: "clip.mp4",
        type: "video/mp4",
        buffer: Buffer.from("not-a-real-video"),
      },
      {
        parseVideoAttachment: async ({ name }) => ({
          parsedText: `【视频附件】${name}\n- 状态：mock`,
          usedTools: [],
        }),
      },
    );
    expect(parsed.kind).toBe("video");
    expect(parsed.parsedText).toContain("clip.mp4");
  });

  it("surfaces LibreOffice missing error for legacy .doc", async () => {
    await expect(
      parseAttachmentFile(
        {
          name: "legacy.doc",
          type: "application/msword",
          buffer: Buffer.from("fake"),
        },
        {
          convertLegacyOffice: async () => {
            throw new Error("未检测到 LibreOffice，无法解析旧版 .doc/.ppt。macOS 可执行：brew install --cask libreoffice");
          },
        },
      ),
    ).rejects.toThrow(/LibreOffice/);
  });

  it("parses .doc via converted docx buffer", async () => {
    // Minimal docx (zip) with word/document.xml containing text
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>HelloFromDoc</w:t></w:r></w:p></w:body>
</w:document>`,
    );
    const docxBuf = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
    const convertLegacyOffice = vi.fn().mockResolvedValue(docxBuf);

    const parsed = await parseAttachmentFile(
      {
        name: "legacy.doc",
        type: "application/msword",
        buffer: Buffer.from("ole"),
      },
      { convertLegacyOffice },
    );

    expect(convertLegacyOffice).toHaveBeenCalledWith(
      expect.objectContaining({ fromExt: "doc", toExt: "docx" }),
    );
    expect(parsed.parsedText).toContain("HelloFromDoc");
  });
});
