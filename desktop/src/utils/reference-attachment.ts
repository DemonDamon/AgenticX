import type { MessageAttachment } from "../store";

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
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
