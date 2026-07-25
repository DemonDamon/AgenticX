/**
 * Max bytes allowed for writeLocalTextFile.
 * MUST stay in sync with WRITE_LOCAL_TEXT_MAX_BYTES in
 * desktop/electron/write-local-text-file.ts.
 */
export const WRITE_LOCAL_TEXT_MAX_BYTES = 512 * 1024;

export type TextEol = "lf" | "crlf";

export function detectTextEol(content: string): TextEol {
  return content.includes("\r\n") ? "crlf" : "lf";
}

/** Normalize editor buffer to LF for textarea editing. */
export function toEditorLf(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Restore EOL before persisting to disk. */
export function applyTextEol(content: string, eol: TextEol): string {
  const lf = toEditorLf(content);
  if (eol === "crlf") return lf.replace(/\n/g, "\r\n");
  return lf;
}
