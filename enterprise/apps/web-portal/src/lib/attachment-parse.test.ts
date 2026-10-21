import { describe, expect, it, vi } from "vitest";
import { parseAttachmentFile } from "./attachment-parse";
import JSZip from "jszip";

const drawingNs = "http://schemas.openxmlformats.org/drawingml/2006/main";
const presentationNs = "http://schemas.openxmlformats.org/presentationml/2006/main";
const relationshipNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const slide = (content: string) => `<p:sld xmlns:p="${presentationNs}" xmlns:a="${drawingNs}"><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:sld>`;
const box = (text: string, x?: number, y = 1000, height = 400) => `<p:sp>${x === undefined ? "" : `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="800" cy="${height}"/></a:xfrm></p:spPr>`}<p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const group = (content: string, attributes = "") => `<p:grpSp><p:grpSpPr><a:xfrm ${attributes}><a:off x="3000" y="2000"/><a:ext cx="4000" cy="1000"/><a:chOff x="500" y="100"/><a:chExt cx="2000" cy="500"/></a:xfrm></p:grpSpPr>${content}</p:grpSp>`;
async function pptx(slides: string[]) {
  const zip = new JSZip();
  slides.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, slide(xml)));
  return zip;
}
async function parsePptx(zip: JSZip) {
  const converted = vi.fn();
  const result = await parseAttachmentFile(
    {
      name: "synthetic.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: await zip.generateAsync({ type: "nodebuffer" }),
    },
    { convertLegacyOffice: converted },
  );
  expect(converted).not.toHaveBeenCalled();
  return result.parsedText;
}

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

describe("PPTX visual reading order", () => {
  it.each([0, 40])("places the top title before left-to-right boxes despite XML order and %i vertical jitter", async (jitter) => {
    const zip = await pptx([
      box("模块丙", 2700, 1000) + box("模块甲", 300, 1000 + jitter) + box("模块丁", 3900, 1000)
      + box("合成页标题", 300, 0, 300) + box("模块乙", 1500, 1000 - jitter),
    ]);
    expect(await parsePptx(zip)).toBe("合成页标题\n模块甲\n模块乙\n模块丙\n模块丁");
  });

  it("follows presentation slide order instead of filenames", async () => {
    const zip = await pptx([box("声明第二页", 0), box("声明第一页", 0), box("未引用页", 0)]);
    zip.file("ppt/presentation.xml", `<p:presentation xmlns:p="${presentationNs}" xmlns:r="${relationshipNs}"><p:sldIdLst><p:sldId id="257" r:id="rId7"/><p:sldId id="256" r:id="rId4"/></p:sldIdLst></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId4" Type="${relationshipNs}/slide" Target="slides/slide1.xml"/><Relationship Id="rId7" Type="${relationshipNs}/slide" Target="/ppt/slides/slide2.xml"/></Relationships>`);
    expect(await parsePptx(zip)).toBe("声明第一页\n\n声明第二页");
  });

  it("keeps an 80-slide cap when presentation metadata is missing", async () => {
    const zip = await pptx(Array.from({ length: 81 }, (_, i) => box(`合成页${i + 1}`, 0)));
    const text = await parsePptx(zip);
    expect(text.split("\n\n")).toHaveLength(80);
    expect(text).not.toContain("合成页81");
  });

  it("rejects a DOCTYPE instead of resolving external entities", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", `<!DOCTYPE p:sld [<!ENTITY secret SYSTEM "file:///etc/passwd">]>${slide(box("&secret;", 0))}`);
    await expect(parsePptx(zip)).rejects.toThrow("DOCTYPE");
  });
});
