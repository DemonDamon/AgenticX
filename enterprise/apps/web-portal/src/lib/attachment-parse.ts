import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { convertLegacyOffice } from "./office-convert";
import { parseVideoAttachment } from "./video-probe";
import { MAX_PARSE_FILE_BYTES, MAX_PARSED_TEXT_CHARS } from "./attachment-parse-limits";

export { MAX_PARSE_FILE_BYTES, MAX_PARSED_TEXT_CHARS };

export type ParsedAttachment = {
  name: string;
  mimeType: string;
  kind: "document" | "video";
  parsedText: string;
};

export type ParseAttachmentDeps = {
  convertLegacyOffice?: typeof convertLegacyOffice;
  parseVideoAttachment?: typeof parseVideoAttachment;
};

function truncate(text: string, max = MAX_PARSED_TEXT_CHARS): string {
  const normalized = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}\n\n…(已截断)`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

async function extractSpreadsheet(buffer: Buffer): Promise<string> {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const chunks: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 20)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) chunks.push(`## ${sheetName}\n${csv}`);
  }
  return chunks.join("\n\n");
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const texts: string[] = [];
  for (const path of slideFiles.slice(0, 80)) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) ?? [];
    const slideText = matches
      .map((m) => m.replace(/<\/?a:t[^>]*>/g, "").trim())
      .filter(Boolean)
      .join(" ");
    if (slideText) texts.push(slideText);
  }
  return texts.join("\n\n");
}

export async function parseAttachmentFile(
  file: {
    name: string;
    type: string;
    buffer: Buffer;
  },
  deps: ParseAttachmentDeps = {},
): Promise<ParsedAttachment> {
  if (file.buffer.byteLength > MAX_PARSE_FILE_BYTES) {
    throw new Error(`文件超过 ${Math.round(MAX_PARSE_FILE_BYTES / 1024 / 1024)}MB 上限`);
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  const ext = extOf(file.name);
  const convert = deps.convertLegacyOffice ?? convertLegacyOffice;
  const parseVideo = deps.parseVideoAttachment ?? parseVideoAttachment;

  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "m4v", "avi", "mkv"].includes(ext)) {
    const video = await parseVideo({ name: file.name, buffer: file.buffer });
    return {
      name: file.name,
      mimeType: mime.startsWith("video/") ? mime : "video/mp4",
      kind: "video",
      parsedText: video.parsedText,
    };
  }

  let text = "";
  if (ext === "pdf" || mime.includes("pdf")) {
    text = await extractPdf(file.buffer);
  } else if (ext === "docx" || mime.includes("wordprocessingml")) {
    text = await extractDocx(file.buffer);
  } else if (ext === "doc") {
    const converted = await convert({ buffer: file.buffer, fromExt: "doc", toExt: "docx" });
    text = await extractDocx(converted);
  } else if (
    ["xlsx", "xls", "csv"].includes(ext) ||
    mime.includes("sheet") ||
    mime.includes("excel") ||
    mime === "text/csv"
  ) {
    if (ext === "csv" || mime === "text/csv") {
      text = file.buffer.toString("utf8");
    } else {
      text = await extractSpreadsheet(file.buffer);
    }
  } else if (ext === "pptx" || mime.includes("presentationml")) {
    text = await extractPptx(file.buffer);
  } else if (ext === "ppt") {
    const converted = await convert({ buffer: file.buffer, fromExt: "ppt", toExt: "pptx" });
    text = await extractPptx(converted);
  } else if (["txt", "md", "json"].includes(ext) || mime.startsWith("text/") || mime === "application/json") {
    text = file.buffer.toString("utf8");
  } else {
    throw new Error(`暂不支持解析该文件类型：${file.name}`);
  }

  const parsedText = truncate(text);
  if (!parsedText) {
    throw new Error(`未能从「${file.name}」提取到文本内容`);
  }
  return {
    name: file.name,
    mimeType: mime || "application/octet-stream",
    kind: "document",
    parsedText,
  };
}
