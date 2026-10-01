import { readScopedLocalStorage, scopedKey } from "./backend-scope";

export const COMPOSER_DRAFT_STORAGE_KEY = "agx-composer-drafts-v1";

const STORAGE_VERSION = 1;
export const MAX_COMPOSER_DRAFT_TEXT_CHARS = 100_000;
export const MAX_COMPOSER_DRAFT_ENTRIES = 80;

export type ComposerDraftEntry = {
  text: string;
  updatedAt: number;
};

type ComposerDraftCollection = {
  version: typeof STORAGE_VERSION;
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

function normalizeDraftEntry(value: unknown): ComposerDraftEntry | null {
  if (!isRecord(value)) return null;
  const text = boundedString(value.text, MAX_COMPOSER_DRAFT_TEXT_CHARS);
  const updatedAt = Number(value.updatedAt);
  if (!text.trim() || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  return { text, updatedAt };
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
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !isRecord(parsed.drafts)) {
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

export function serializeComposerDrafts(
  drafts: Record<string, ComposerDraftEntry>,
): string {
  const bounded: Record<string, ComposerDraftEntry> = {};
  for (const [rawKey, rawEntry] of Object.entries(drafts)) {
    const key = normalizeDraftKey(rawKey);
    if (!key) continue;
    const entry = normalizeDraftEntry(rawEntry);
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
  const raw = serializeComposerDrafts(drafts);
  try {
    window.localStorage.setItem(scopedKey(COMPOSER_DRAFT_STORAGE_KEY), raw);
    return true;
  } catch {
    return false;
  }
}

export function getComposerDraftText(key: string): string {
  const normalized = normalizeDraftKey(key);
  if (!normalized) return "";
  return loadComposerDrafts()[normalized]?.text ?? "";
}

/** Upsert draft text; blank/whitespace-only clears the slot. */
export function upsertComposerDraft(key: string, text: string): void {
  const normalized = normalizeDraftKey(key);
  if (!normalized) return;
  const trimmedCapable = boundedString(text, MAX_COMPOSER_DRAFT_TEXT_CHARS);
  const drafts = loadComposerDrafts();
  if (!trimmedCapable.trim()) {
    if (!(normalized in drafts)) return;
    delete drafts[normalized];
    saveComposerDrafts(drafts);
    return;
  }
  drafts[normalized] = {
    text: trimmedCapable,
    updatedAt: Date.now(),
  };
  saveComposerDrafts(drafts);
}

export function clearComposerDraft(key: string): void {
  const normalized = normalizeDraftKey(key);
  if (!normalized) return;
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
  drafts[toKey] = {
    text: from.text,
    updatedAt: Date.now(),
  };
  delete drafts[fromKey];
  saveComposerDrafts(drafts);
}
