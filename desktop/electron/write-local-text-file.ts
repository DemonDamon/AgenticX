import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** MUST stay in sync with desktop/src/components/workspace/workspace-edit-limits.ts */
export const WRITE_LOCAL_TEXT_MAX_BYTES = 512 * 1024;

export type WriteLocalTextFilePayload = {
  path?: string;
  content?: string;
  expectedMtimeMs?: number;
  eol?: "lf" | "crlf";
};

export type WriteLocalTextFileResult = {
  ok: boolean;
  size?: number;
  mtimeMs?: number;
  error?: string;
  code?: "STALE" | string;
};

function applyEol(content: string, eol: "lf" | "crlf" | undefined): string {
  if (eol === "crlf") {
    return content.replace(/\r?\n/g, "\r\n");
  }
  return content;
}

/**
 * Atomically write a UTF-8 text file with optional mtime guard and EOL restore.
 * `normalizePath` should expand ~ and resolve to an absolute path.
 */
export async function writeLocalTextFileAtomic(
  payload: WriteLocalTextFilePayload,
  normalizePath: (raw: string) => string,
): Promise<WriteLocalTextFileResult> {
  const raw = String(payload?.path || "").trim();
  if (!raw) return { ok: false, error: "empty path" };
  const normalized = normalizePath(raw);
  if (!normalized) return { ok: false, error: "empty path" };
  if (!fs.existsSync(normalized)) {
    return { ok: false, error: "file not found" };
  }

  const stat = await fs.promises.stat(normalized);
  if (stat.isDirectory()) {
    return { ok: false, error: "path is a directory" };
  }

  if (
    typeof payload.expectedMtimeMs === "number" &&
    Number.isFinite(payload.expectedMtimeMs) &&
    Math.abs(stat.mtimeMs - payload.expectedMtimeMs) > 1
  ) {
    return { ok: false, error: "file changed on disk", code: "STALE" };
  }

  let content = String(payload?.content ?? "");
  content = applyEol(content, payload.eol);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > WRITE_LOCAL_TEXT_MAX_BYTES) {
    return {
      ok: false,
      error: `file too large to write (${bytes} bytes > ${WRITE_LOCAL_TEXT_MAX_BYTES})`,
    };
  }

  const dir = path.dirname(normalized);
  const base = path.basename(normalized);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.promises.writeFile(tmp, content, "utf8");
    await fs.promises.rename(tmp, normalized);
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) await fs.promises.unlink(tmp);
    } catch {
      /* ignore cleanup errors */
    }
    return { ok: false, error: String(err) };
  }

  const after = await fs.promises.stat(normalized);
  return { ok: true, size: bytes, mtimeMs: after.mtimeMs };
}

/** Test helper: host name unused but keeps API discoverable. */
export function writeLocalTextTempRoot(): string {
  return os.tmpdir();
}
