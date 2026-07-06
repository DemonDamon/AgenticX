import type { MessageAttachment } from "../store";
import {
  fileNameFromPath,
  resolveReferenceSourcePath,
  stripLineRangeFromAbsPath,
} from "./chat-file-mention";
import { isMisclassifiedUploadReference } from "./composer-upload-key";

export type FileReferenceOpenRequest = {
  absolutePath: string;
  lineRange?: { start: number; end: number };
};

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export function resolveAttachmentLineRange(att: MessageAttachment): { start: number; end: number } | undefined {
  if (att.lineRange) return att.lineRange;
  return (
    parseLineRangeFromReferenceLabel(String(att.name || "")) ??
    parseLineRangeFromReferenceLabel(String(att.composerRefLabel || ""))
  );
}

function resolveAttachmentBasename(att: MessageAttachment): string {
  const sourcePath = String(att.sourcePath || "")
    .trim()
    .replace(/\\/g, "/");
  if (sourcePath) return fileNameFromPath(sourcePath);
  const name = String(att.name || "")
    .trim()
    .replace(/:\d+-\d+$/, "")
    .replace(/#\s*.*/, "");
  return fileNameFromPath(name.replace(/\\/g, "/")) || name;
}

/** All @-mention spellings we should recognize in user message bodies (longest match wins). */
export function collectReferenceMatchLabels(att: MessageAttachment): string[] {
  const out = new Set<string>();
  const composerRefLabel = String(att.composerRefLabel || "").trim();
  const name = String(att.name || "").trim();
  const sourcePath = String(att.sourcePath || "")
    .trim()
    .replace(/\\/g, "/");
  for (const candidate of [composerRefLabel, name, sourcePath]) {
    if (candidate) out.add(candidate);
  }
  const baseName = resolveAttachmentBasename(att);
  if (baseName) out.add(baseName);
  const lineRange = resolveAttachmentLineRange(att);
  if (lineRange && baseName) {
    out.add(`${baseName} (${lineRange.start}-${lineRange.end})`);
    out.add(`${baseName}:${lineRange.start}-${lineRange.end}`);
    out.add(`${baseName} :${lineRange.start}-${lineRange.end}`);
  }
  if (lineRange && sourcePath) {
    out.add(`${sourcePath}:${lineRange.start}-${lineRange.end}`);
  }
  return Array.from(out).filter(Boolean);
}

/** True when text immediately after an @file label ends the mention token (not mid-word). */
export function isReferenceMentionBoundary(after: string): boolean {
  return mentionBoundaryOk(after);
}

function mentionBoundaryOk(after: string): boolean {
  if (after.length === 0) return true;
  if (/^:\d+-\d+/.test(after) || /^\(\d+-\d+\)/.test(after)) return false;
  if (/^\s/.test(after)) return true;
  // Sentence punctuation (CN/EN) ends the @mention — e.g. `@README.md (224-224)，你是…`
  if (/^[,，。！？；：、.!?;:)\]}>」』】]/.test(after)) return true;
  return false;
}

/** Match the @file reference label after `@` in user message text. Returns the consumed label. */
export function matchReferenceMentionLabel(
  rest: string,
  attachments: MessageAttachment[]
): string | null {
  const refs = attachments.filter(isWorkspaceReferenceAttachment);
  if (!refs.length) return null;

  const lineSuffix = rest.match(/^([^\s@]+?)\s*:(\d+)-(\d+)/);
  if (lineSuffix) {
    const basePart = lineSuffix[1]!.trim();
    const start = Math.max(1, parseInt(lineSuffix[2]!, 10));
    const end = Math.max(start, parseInt(lineSuffix[3]!, 10));
    const canonical = `${basePart}:${start}-${end}`;
    const after = rest.slice(lineSuffix[0].length);
    if (!mentionBoundaryOk(after)) {
      // continue to label loop
    } else if (
      findReferenceAttachmentMeta(canonical, refs) ||
      refs.some((att) => {
        const range = resolveAttachmentLineRange(att);
        return (
          !!range &&
          range.start === start &&
          range.end === end &&
          (resolveAttachmentBasename(att) === basePart ||
            resolveAttachmentBasename(att) === fileNameFromPath(basePart))
        );
      })
    ) {
      return lineSuffix[0];
    }
  }

  const parenSuffix = rest.match(/^([^\s@]+?)\s*\((\d+)-(\d+)\)/);
  if (parenSuffix) {
    const basePart = parenSuffix[1]!.trim();
    const start = Math.max(1, parseInt(parenSuffix[2]!, 10));
    const end = Math.max(start, parseInt(parenSuffix[3]!, 10));
    const canonical = `${basePart} (${start}-${end})`;
    const after = rest.slice(parenSuffix[0].length);
    if (
      mentionBoundaryOk(after) &&
      (findReferenceAttachmentMeta(canonical, refs) ||
        refs.some((att) => {
          const range = resolveAttachmentLineRange(att);
          return (
            !!range &&
            range.start === start &&
            range.end === end &&
            (resolveAttachmentBasename(att) === basePart ||
              resolveAttachmentBasename(att) === fileNameFromPath(basePart))
          );
        }))
    ) {
      return parenSuffix[0];
    }
  }

  const labels = Array.from(new Set(refs.flatMap(collectReferenceMatchLabels))).sort(
    (a, b) => b.length - a.length
  );
  for (const name of labels) {
    if (!rest.startsWith(name)) continue;
    const after = rest.slice(name.length);
    if (!mentionBoundaryOk(after)) continue;
    if (!parseLineRangeFromReferenceLabel(name)) {
      const trimmedAfter = after.trimStart();
      if (/^:\d+-\d+/.test(trimmedAfter) || /^\(\d+-\d+\)/.test(trimmedAfter)) {
        continue;
      }
    }
    return name;
  }
  return null;
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
  const rawName = String(name || "")
    .trim()
    .replace(/\s+:(\d+)-(\d+)$/, ":$1-$2");
  const lineRange =
    (meta ? resolveAttachmentLineRange(meta) : undefined) ??
    parseLineRangeFromReferenceLabel(rawName);
  const normalizedName = stripLineRangeFromAbsPath(rawName);
  const absolutePath = resolveReferenceSourcePath(normalizedName, meta?.sourcePath);
  if (!absolutePath) return null;
  return lineRange ? { absolutePath, lineRange } : { absolutePath };
}

/** Match @ chip label to attachment metadata (filename, alias, or absolute path). */
export function findReferenceAttachmentMeta(
  label: string,
  attachments: MessageAttachment[]
): MessageAttachment | undefined {
  const needle = String(label || "").trim();
  if (!needle) return undefined;
  const normalizedNeedle = needle.replace(/\s+:(\d+)-(\d+)$/, ":$1-$2");
  const lineFromNeedle = parseLineRangeFromReferenceLabel(normalizedNeedle);
  const needleBase = lineFromNeedle
    ? normalizedNeedle.replace(/:(\d+)-(\d+)$/, "").replace(/\((\d+)-(\d+)\)\s*$/, "").trim()
    : normalizedNeedle;

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
  if (isMisclassifiedUploadReference(att)) return false;
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
