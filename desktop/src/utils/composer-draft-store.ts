import { readScopedLocalStorage, scopedKey } from "./backend-scope";
import {
  deleteAllDraftAttachmentBlobsSync,
  deleteDraftAttachmentBlobSync,
  getDraftAttachmentBlob,
  getDraftAttachmentBlobSync,
  migrateDraftAttachmentBlobsSync,
  putDraftAttachmentBlobSync,
} from "./composer-draft-blob-store";

export const COMPOSER_DRAFT_STORAGE_KEY = "agx-composer-drafts-v1";

/** v2 adds attachments; still read v1 payloads. */
const STORAGE_VERSION = 2;
const LEGACY_STORAGE_VERSION = 1;
export const MAX_COMPOSER_DRAFT_TEXT_CHARS = 100_000;
export const MAX_COMPOSER_DRAFT_ENTRIES = 80;
export const MAX_COMPOSER_DRAFT_ATTACHMENTS = 8;
/**
 * localStorage must NOT hold large image dataUrls (quota ~5MB).
 * Payloads live in composer-draft-blob-store (memory + IndexedDB).
 * Kept as a soft inline cap if a tiny dataUrl is ever embedded.
 */
export const MAX_COMPOSER_DRAFT_DATA_URL_CHARS = 48_000;

export type ComposerDraftAttachment = {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  status: "parsing" | "ready" | "error";
  content: string;
  dataUrl?: string;
  /** True when image bytes live in the blob store (not in localStorage). */
  hasBlob?: boolean;
  sourcePath?: string;
  referenceToken?: boolean;
  composerRefLabel?: string;
  lineRange?: { start: number; end: number };
  spreadsheetRef?: { sheet: string; a1: string };
  snippetRef?: string;
  snippetContent?: string;
  htmlElementRef?: { tagName: string; selectorHint: string; comment?: string };
  errorText?: string;
};

export type ComposerDraftEntry = {
  text: string;
  attachments: ComposerDraftAttachment[];
  updatedAt: number;
};

type ComposerDraftCollection = {
  version: number;
  drafts: Record<string, ComposerDraftEntry>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function normalizeDraftKey(raw: unknown): string {
  return boundedString(raw, 320).trim();
}

function normalizeLineRange(value: unknown): { start: number; end: number } | undefined {
  if (!isRecord(value)) return undefined;
  const start = Number(value.start);
  const end = Number(value.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return { start, end };
}

function normalizeAttachment(value: unknown): ComposerDraftAttachment | null {
  if (!isRecord(value)) return null;
  const key = boundedString(value.key, 512).trim();
  const name = boundedString(value.name, 512).trim();
  if (!key || !name) return null;
  const statusRaw = String(value.status || "ready");
  const status: ComposerDraftAttachment["status"] =
    statusRaw === "parsing" || statusRaw === "error" ? statusRaw : "ready";
  const size = Number(value.size);
  const mimeType = boundedString(value.mimeType, 256) || "application/octet-stream";
  const content = boundedString(value.content, MAX_COMPOSER_DRAFT_TEXT_CHARS);
  const dataUrlRaw = typeof value.dataUrl === "string" ? value.dataUrl : "";
  const dataUrl =
    dataUrlRaw && dataUrlRaw.length <= MAX_COMPOSER_DRAFT_DATA_URL_CHARS
      ? dataUrlRaw
      : undefined;
  const hasBlob = value.hasBlob === true || Boolean(dataUrlRaw && !dataUrl);
  const sourcePath = boundedString(value.sourcePath, 2048).trim();
  // Ready images need either inline/tiny dataUrl, a blob-store marker, or a path.
  if (
    status === "ready" &&
    mimeType.startsWith("image/") &&
    !dataUrl &&
    !hasBlob &&
    !sourcePath
  ) {
    return null;
  }
  const attachment: ComposerDraftAttachment = {
    key,
    name,
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    mimeType,
    status,
    content,
  };
  if (dataUrl) attachment.dataUrl = dataUrl;
  if (hasBlob) attachment.hasBlob = true;
  if (sourcePath) attachment.sourcePath = sourcePath;
  if (value.referenceToken === true) attachment.referenceToken = true;
  const composerRefLabel = boundedString(value.composerRefLabel, 512).trim();
  if (composerRefLabel) attachment.composerRefLabel = composerRefLabel;
  const lineRange = normalizeLineRange(value.lineRange);
  if (lineRange) attachment.lineRange = lineRange;
  if (isRecord(value.spreadsheetRef)) {
    const sheet = boundedString(value.spreadsheetRef.sheet, 256).trim();
    const a1 = boundedString(value.spreadsheetRef.a1, 64).trim();
    if (sheet && a1) attachment.spreadsheetRef = { sheet, a1 };
  }
  const snippetRef = boundedString(value.snippetRef, 512).trim();
  if (snippetRef) attachment.snippetRef = snippetRef;
  const snippetContent = boundedString(value.snippetContent, MAX_COMPOSER_DRAFT_TEXT_CHARS);
  if (snippetContent) attachment.snippetContent = snippetContent;
  if (isRecord(value.htmlElementRef)) {
    const tagName = boundedString(value.htmlElementRef.tagName, 64).trim();
    const selectorHint = boundedString(value.htmlElementRef.selectorHint, 512).trim();
    const comment = boundedString(value.htmlElementRef.comment, 2000).trim();
    if (tagName) {
      attachment.htmlElementRef = {
        tagName,
        selectorHint,
        ...(comment ? { comment } : {}),
      };
    }
  }
  const errorText = boundedString(value.errorText, 512).trim();
  if (errorText) attachment.errorText = errorText;
  return attachment;
}

function attachmentsForLocalStorage(
  attachments: ComposerDraftAttachment[],
): ComposerDraftAttachment[] {
  return attachments.map((att) => {
    if (!att.dataUrl) return att;
    const { dataUrl: _drop, ...rest } = att;
    return { ...rest, hasBlob: true };
  });
}

function mergeAttachmentBlobsSync(
  draftKey: string,
  attachments: ComposerDraftAttachment[],
): ComposerDraftAttachment[] {
  return attachments.map((att) => {
    if (att.dataUrl) return att;
    const blob = getDraftAttachmentBlobSync(draftKey, att.key);
    if (!blob) return att;
    return { ...att, dataUrl: blob, hasBlob: true };
  });
}

function normalizeAttachments(value: unknown): ComposerDraftAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: ComposerDraftAttachment[] = [];
  for (const item of value.slice(0, MAX_COMPOSER_DRAFT_ATTACHMENTS)) {
    const att = normalizeAttachment(item);
    if (att) out.push(att);
  }
  return out;
}

function normalizeDraftEntry(value: unknown): ComposerDraftEntry | null {
  if (!isRecord(value)) return null;
  const text = boundedString(value.text, MAX_COMPOSER_DRAFT_TEXT_CHARS);
  const attachments = normalizeAttachments(value.attachments);
  const updatedAt = Number(value.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  if (!text.trim() && attachments.length === 0) return null;
  return { text, attachments, updatedAt };
}

/** Session-bound draft key (preferred when a real session exists). */
export function composerDraftKeyForSession(sessionId: string): string {
  const sid = String(sessionId ?? "").trim();
  return sid ? `session:${sid}` : "";
}

/** Pane-local draft key for lazy / empty composers (no session_id yet). */
export function composerDraftKeyForPane(paneId: string): string {
  const id = String(paneId ?? "").trim();
  return id ? `pane:${id}` : "";
}

/** Resolve the storage key for the composer currently shown in a pane. */
export function resolveComposerDraftKey(
  paneId: string,
  sessionId?: string | null,
): string {
  const sessionKey = composerDraftKeyForSession(String(sessionId ?? ""));
  if (sessionKey) return sessionKey;
  return composerDraftKeyForPane(paneId);
}

export function parseComposerDrafts(
  raw: string | null | undefined,
): Record<string, ComposerDraftEntry> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      (parsed.version !== STORAGE_VERSION && parsed.version !== LEGACY_STORAGE_VERSION) ||
      !isRecord(parsed.drafts)
    ) {
      return {};
    }
    const drafts: Record<string, ComposerDraftEntry> = {};
    for (const [rawKey, rawEntry] of Object.entries(parsed.drafts)) {
      const key = normalizeDraftKey(rawKey);
      if (!key) continue;
      const entry = normalizeDraftEntry(rawEntry);
      if (entry) drafts[key] = entry;
    }
    return drafts;
  } catch {
    return {};
  }
}

function pruneDrafts(
  drafts: Record<string, ComposerDraftEntry>,
): Record<string, ComposerDraftEntry> {
  const entries = Object.entries(drafts);
  if (entries.length <= MAX_COMPOSER_DRAFT_ENTRIES) return drafts;
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const next: Record<string, ComposerDraftEntry> = {};
  for (const [key, entry] of entries.slice(0, MAX_COMPOSER_DRAFT_ENTRIES)) {
    next[key] = entry;
  }
  return next;
}

function stripAttachmentDataUrls(
  drafts: Record<string, ComposerDraftEntry>,
): Record<string, ComposerDraftEntry> {
  const next: Record<string, ComposerDraftEntry> = {};
  for (const [key, entry] of Object.entries(drafts)) {
    next[key] = {
      ...entry,
      attachments: attachmentsForLocalStorage(entry.attachments),
    };
  }
  return next;
}

export function serializeComposerDrafts(
  drafts: Record<string, ComposerDraftEntry>,
): string {
  const bounded: Record<string, ComposerDraftEntry> = {};
  for (const [rawKey, rawEntry] of Object.entries(drafts)) {
    const key = normalizeDraftKey(rawKey);
    if (!key) continue;
    // Never embed large dataUrls in the localStorage JSON payload.
    const entry = normalizeDraftEntry({
      ...rawEntry,
      attachments: attachmentsForLocalStorage(rawEntry.attachments ?? []),
    });
    if (entry) bounded[key] = entry;
  }
  const pruned = pruneDrafts(bounded);
  return JSON.stringify({
    version: STORAGE_VERSION,
    drafts: pruned,
  } satisfies ComposerDraftCollection);
}

export function loadComposerDrafts(): Record<string, ComposerDraftEntry> {
  return parseComposerDrafts(readScopedLocalStorage(COMPOSER_DRAFT_STORAGE_KEY));
}

export function saveComposerDrafts(drafts: Record<string, ComposerDraftEntry>): boolean {
  const tryWrite = (payload: Record<string, ComposerDraftEntry>) => {
    const raw = serializeComposerDrafts(payload);
    window.localStorage.setItem(scopedKey(COMPOSER_DRAFT_STORAGE_KEY), raw);
  };
  try {
    tryWrite(drafts);
    return true;
  } catch {
    // Quota: metadata-only retry (blobs already offloaded).
    try {
      tryWrite(stripAttachmentDataUrls(drafts));
      return true;
    } catch {
      return false;
    }
  }
}

function withSyncedBlobs(
  key: string,
  entry: ComposerDraftEntry | null,
): ComposerDraftEntry | null {
  if (!entry) return null;
  return {
    ...entry,
    attachments: mergeAttachmentBlobsSync(key, entry.attachments),
  };
}

export function getComposerDraft(key: string): ComposerDraftEntry | null {
  const normalized = normalizeDraftKey(key);
  if (!normalized) return null;
  return withSyncedBlobs(normalized, loadComposerDrafts()[normalized] ?? null);
}

export function getComposerDraftText(key: string): string {
  return getComposerDraft(key)?.text ?? "";
}

export function getComposerDraftAttachments(key: string): ComposerDraftAttachment[] {
  return getComposerDraft(key)?.attachments ?? [];
}

/**
 * Cold-start hydrate: pull image payloads from IndexedDB when the in-memory
 * blob cache is empty (e.g. after app restart / pane close across reloads).
 */
export async function hydrateComposerDraft(
  key: string,
): Promise<ComposerDraftEntry | null> {
  const normalized = normalizeDraftKey(key);
  if (!normalized) return null;
  const entry = loadComposerDrafts()[normalized] ?? null;
  if (!entry) return null;
  const attachments = await Promise.all(
    entry.attachments.map(async (att) => {
      if (att.dataUrl) return att;
      const fromMem = getDraftAttachmentBlobSync(normalized, att.key);
      if (fromMem) return { ...att, dataUrl: fromMem, hasBlob: true };
      if (!att.hasBlob && !att.mimeType.startsWith("image/")) return att;
      const fromIdb = await getDraftAttachmentBlob(normalized, att.key);
      if (!fromIdb) return att;
      return { ...att, dataUrl: fromIdb, hasBlob: true };
    }),
  );
  return { ...entry, attachments };
}

/** Upsert draft; blank text + no attachments clears the slot. */
export function upsertComposerDraft(
  key: string,
  text: string,
  attachments: ComposerDraftAttachment[] = [],
): void {
  const normalized = normalizeDraftKey(key);
  if (!normalized) return;

  // Offload image bytes before localStorage normalize (which strips large dataUrls).
  const keptKeys = new Set<string>();
  for (const att of attachments) {
    const ak = String(att.key || "").trim();
    if (!ak) continue;
    keptKeys.add(ak);
    if (att.dataUrl) putDraftAttachmentBlobSync(normalized, ak, att.dataUrl);
  }

  const entry = normalizeDraftEntry({
    text: boundedString(text, MAX_COMPOSER_DRAFT_TEXT_CHARS),
    attachments: attachmentsForLocalStorage(attachments),
    updatedAt: Date.now(),
  });
  const drafts = loadComposerDrafts();
  if (!entry) {
    deleteAllDraftAttachmentBlobsSync(normalized);
    if (!(normalized in drafts)) return;
    delete drafts[normalized];
    saveComposerDrafts(drafts);
    return;
  }

  // Drop blob payloads for attachments removed from this draft.
  const prev = drafts[normalized];
  if (prev) {
    for (const old of prev.attachments) {
      if (!keptKeys.has(old.key)) deleteDraftAttachmentBlobSync(normalized, old.key);
    }
  }

  drafts[normalized] = entry;
  saveComposerDrafts(drafts);
}

export function clearComposerDraft(key: string): void {
  const normalized = normalizeDraftKey(key);
  if (!normalized) return;
  deleteAllDraftAttachmentBlobsSync(normalized);
  const drafts = loadComposerDrafts();
  if (!(normalized in drafts)) return;
  delete drafts[normalized];
  saveComposerDrafts(drafts);
}

/**
 * Move a pane-scoped draft onto a newly created session key.
 * Used when lazy createSession finally allocates a session_id.
 */
export function migrateActiveComposerDraftToSession(
  paneId: string,
  sessionId: string,
): void {
  const fromKey = composerDraftKeyForPane(paneId);
  const toKey = composerDraftKeyForSession(sessionId);
  if (!fromKey || !toKey || fromKey === toKey) return;
  const drafts = loadComposerDrafts();
  const from = drafts[fromKey];
  if (!from) return;
  migrateDraftAttachmentBlobsSync(
    fromKey,
    toKey,
    from.attachments.map((a) => a.key),
  );
  drafts[toKey] = {
    text: from.text,
    attachments: from.attachments,
    updatedAt: Date.now(),
  };
  delete drafts[fromKey];
  saveComposerDrafts(drafts);
}
