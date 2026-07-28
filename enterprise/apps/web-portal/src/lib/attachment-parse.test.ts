import { describe, expect, it } from "vitest";
import { parseAttachmentFile } from "./attachment-parse";

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

  it("returns a filename note for video uploads", async () => {
    const parsed = await parseAttachmentFile({
      name: "clip.mp4",
      type: "video/mp4",
      buffer: Buffer.from("not-a-real-video"),
    });
    expect(parsed.kind).toBe("video");
    expect(parsed.parsedText).toContain("clip.mp4");
  });

  it("rejects unsupported legacy .doc", async () => {
    await expect(
      parseAttachmentFile({
        name: "legacy.doc",
        type: "application/msword",
        buffer: Buffer.from("fake"),
      }),
    ).rejects.toThrow(/不支持|docx|格式/i);
  });
});
