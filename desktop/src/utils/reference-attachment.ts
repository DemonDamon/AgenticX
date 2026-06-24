import type { MessageAttachment } from "../store";
import { resolveReferenceSourcePath } from "./chat-file-mention";

export type FileReferenceOpenRequest = {
  absolutePath: string;
  lineRange?: { start: number; end: number };
};

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export function parseLineRangeFromReferenceLabel(label: string): { start: number; end: number } | undefined {
  const text = String(label || "").trim();
  if (!text) return undefined;
  const colonMatch = text.match(/:(\d+)-(\d+)$/);
  if (colonMatch) {
    const start = Math.max(1, parseInt(colonMatch[1]!, 10));
    const end = Math.max(start, parseInt(colonMatch[2]!, 10));
    return { start, end };
  }
  const parenMatch = text.match(/\((\d+)-(\d+)\)$/);
  if (parenMatch) {
    const start = Math.max(1, parseInt(parenMatch[1]!, 10));
    const end = Math.max(start, parseInt(parenMatch[2]!, 10));
    return { start, end };
  }
  return undefined;
}

export function buildFileReferenceOpenRequest(
  name: string,
  meta?: MessageAttachment
): FileReferenceOpenRequest | null {
  const absolutePath = resolveReferenceSourcePath(name, meta?.sourcePath);
  if (!absolutePath) return null;
  const lineRange = meta?.lineRange ?? parseLineRangeFromReferenceLabel(name);
  return lineRange ? { absolutePath, lineRange } : { absolutePath };
}

/** Match @ chip label to attachment metadata (filename, alias, or absolute path). */
export function findReferenceAttachmentMeta(
  label: string,
  attachments: MessageAttachment[]
): MessageAttachment | undefined {
  const needle = String(label || "").trim();
  if (!needle) return undefined;
  const lineFromNeedle = parseLineRangeFromReferenceLabel(needle);
  const needleBase = lineFromNeedle
    ? needle.replace(/:(\d+)-(\d+)$/, "").replace(/\((\d+)-(\d+)\)\s*$/, "").trim()
    : needle;

  for (const att of attachments) {
    const composerRefLabel = String(att.composerRefLabel || "").trim();
    const name = String(att.name || "").trim();
    const sourcePath = String(att.sourcePath || "")
      .trim()
      .replace(/\\/g, "/");
    if (composerRefLabel === needle || name === needle || sourcePath === needle) return att;
    if (sourcePath && basename(sourcePath) === needle) return att;
    if (name && basename(name) === needle) return att;
    if (lineFromNeedle && att.lineRange) {
      const sameRange =
        att.lineRange.start === lineFromNeedle.start && att.lineRange.end === lineFromNeedle.end;
      if (!sameRange) continue;
      const candidates = [
        composerRefLabel,
        name,
        basename(sourcePath),
        basename(name.replace(/:\d+-\d+$/, "")),
      ].filter(Boolean);
      if (
        candidates.some(
          (candidate) =>
            candidate === needle ||
            candidate === needleBase ||
            basename(candidate) === needleBase ||
            candidate.endsWith(`:${lineFromNeedle.start}-${lineFromNeedle.end}`) ||
            candidate.endsWith(`(${lineFromNeedle.start}-${lineFromNeedle.end})`)
        )
      ) {
        return att;
      }
    }
    if (lineFromNeedle && name.endsWith(`:${lineFromNeedle.start}-${lineFromNeedle.end}`)) {
      const nameBase = basename(name.replace(/:\d+-\d+$/, ""));
      if (nameBase === needleBase || needle.endsWith(nameBase)) return att;
    }
  }
  return undefined;
}

/** Workspace @file / snippet rows — not chat-upload AttachmentCards. */
export function isWorkspaceReferenceAttachment(att: MessageAttachment): boolean {
  if (att.referenceToken) return true;
  if (String(att.composerRefLabel || "").trim()) return true;
  if (att.lineRange || att.spreadsheetRef || att.snippetRef) return true;
  const name = String(att.name || "").trim();
  if (/:\d+-\d+$/.test(name)) return true;
  if (/:snippet-[0-9a-f]+$/i.test(name)) return true;
  if (/#[^!]+!.+/.test(name)) return true;
  return false;
}

export function inferComposerRefLabel(att: MessageAttachment): string | undefined {
  const existing = String(att.composerRefLabel || "").trim();
  if (existing) return existing;
  if (att.lineRange) {
    const base = basename(String(att.sourcePath || att.name).replace(/:\d+-\d+$/, ""));
    return `${base} (${att.lineRange.start}-${att.lineRange.end})`;
  }
  if (att.spreadsheetRef) {
    const base = basename(String(att.sourcePath || att.name.split("#")[0] || att.name));
    return `${base} · ${att.spreadsheetRef.sheet} · ${att.spreadsheetRef.a1}`;
  }
  if (att.snippetRef) {
    const base = basename(String(att.sourcePath || att.name).replace(/:snippet-[0-9a-f]+$/i, ""));
    return `${base} (片段)`;
  }
  const lineMatch = String(att.name || "").match(/^(.+):(\d+)-(\d+)$/);
  if (lineMatch) {
    return `${basename(lineMatch[1]!)} (${lineMatch[2]}-${lineMatch[3]})`;
  }
  const snippetMatch = String(att.name || "").match(/^(.+):(snippet-[0-9a-f]+)$/i);
  if (snippetMatch) {
    return `${basename(snippetMatch[1]!)} (片段)`;
  }
  const sheetMatch = String(att.name || "").match(/^(.+)#([^!]+)!(.+)$/);
  if (sheetMatch) {
    return `${basename(sheetMatch[1]!)} · ${sheetMatch[2]} · ${sheetMatch[3]}`;
  }
  return undefined;
}

/** Normalize persisted rows so reload / session switch keeps inline @file chips. */
export function normalizeReferenceAttachments(
  attachments: MessageAttachment[] | undefined
): MessageAttachment[] | undefined {
  if (!attachments?.length) return attachments;
  let changed = false;
  const out = attachments.map((att) => {
    if (!isWorkspaceReferenceAttachment(att)) return att;
    const composerRefLabel = inferComposerRefLabel(att);
    const next: MessageAttachment = {
      ...att,
      referenceToken: true,
      ...(composerRefLabel ? { composerRefLabel } : {}),
    };
    if (
      next.referenceToken !== att.referenceToken ||
      next.composerRefLabel !== att.composerRefLabel
    ) {
      changed = true;
    }
    return next;
  });
  return changed ? out : attachments;
}
