import type { MessageAttachment } from "../store";

/** Desktop composer map key for drag/paste uploads: `name:size:lastModified`. */
const UPLOAD_DEDUPE_KEY_RE = /^(.+):(\d+):(\d{10,})$/;

export function isComposerUploadDedupeKey(key: string): boolean {
  const text = String(key || "").trim();
  const match = text.match(UPLOAD_DEDUPE_KEY_RE);
  if (!match) return false;
  const size = Number(match[2]);
  const ts = Number(match[3]);
  return Number.isFinite(size) && size >= 0 && ts >= 1_000_000_000_000;
}

export function stripComposerUploadDedupeKey(key: string): string {
  const text = String(key || "").trim();
  if (!isComposerUploadDedupeKey(text)) return text;
  const match = text.match(UPLOAD_DEDUPE_KEY_RE);
  return match?.[1]?.trim() || text;
}

/** Persisted/hydrated rows mis-tagged as workspace refs after backend line-range parse. */
export function isMisclassifiedUploadReference(att: MessageAttachment): boolean {
  if (!att.referenceToken) return false;
  const end = att.lineRange?.end;
  if (typeof end === "number" && end >= 1_000_000_000_000) return true;
  const sourcePath = String(att.sourcePath || "").trim();
  const name = String(att.name || "").trim();
  const bareName =
    !sourcePath.includes("/") &&
    !sourcePath.includes("\\") &&
    !sourcePath.startsWith("@") &&
    !name.includes("/") &&
    !name.includes("\\");
  if (!bareName) return false;
  if (typeof end === "number" && end > 100_000) return true;
  const label = String(att.composerRefLabel || "").trim();
  if (label && /\(\d+-1\d{11,}\)/.test(label)) return true;
  return false;
}
