export type ComposerAttachmentStatus = "uploading" | "parsing" | "ready" | "error";

export type ComposerAttachmentKind = "image" | "document" | "video";

export type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: ComposerAttachmentStatus;
  kind?: ComposerAttachmentKind;
  dataUrl?: string;
  parsedText?: string;
  errorText?: string;
  /** 0-100, meaningful only while status === "uploading" */
  uploadProgress?: number;
  /** Set by parse API when original file is retained (P2). */
  attachmentId?: string;
};

/** Max attachments per message (aligned with common product caps). */
export const MAX_ATTACHMENTS = 50;
/** Per-file size cap for upload (bytes). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/**
 * Compressed image data URL char budget (align with sanitize ~8e6, with margin).
 * Upload may accept larger files; they are compressed before embedding.
 */
export const MAX_IMAGE_DATA_URL_CHARS = 7_500_000;
/**
 * @deprecated No longer a hard reject for uploads — images up to MAX_FILE_BYTES
 * are accepted then compressed. Alias kept for callers that still import it.
 */
export const MAX_IMAGE_BYTES = MAX_FILE_BYTES;
/** @deprecated use MAX_ATTACHMENTS */
export const MAX_IMAGE_ATTACHMENTS = MAX_ATTACHMENTS;

export const DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,image/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown,text/csv,application/json";

export function classifyAttachment(file: File): ComposerAttachmentKind | null {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) {
    return "image";
  }
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(name)) {
    return "video";
  }
  if (
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("sheet") ||
    mime.includes("excel") ||
    mime.includes("powerpoint") ||
    mime.includes("presentation") ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|json)$/i.test(name)
  ) {
    return "document";
  }
  return null;
}
