import { readScopedLocalStorage, writeScopedLocalStorage } from "./backend-scope";

export const COMPOSER_DRAFT_STORAGE_KEY = "agx-composer-drafts-v1";
export const COMPOSER_DRAFT_SAVE_DEBOUNCE_MS = 250;
export const COMPOSER_DRAFT_MAX_ENTRIES = 50;
export const COMPOSER_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const COMPOSER_DRAFT_MAX_STORE_CHARS = 4_000_000;
export const COMPOSER_DRAFT_MAX_INLINE_DATA_URL_CHARS = 1_200_000;

const COMPOSER_DRAFT_VERSION = 1 as const;
const MAX_TEXT_CHARS = 200_000;
const MAX_ATTACHMENT_COUNT = 24;
const MAX_QUOTE_COUNT = 24;
const MAX_REF_COUNT = 64;
const MAX_ATTACHMENT_CONTENT_CHARS = 32_000;
const MAX_QUOTE_CHARS = 32_000;
const MAX_PATH_CHARS = 4_096;
const MAX_LABEL_CHARS = 512;

export type ComposerDraftIdentityInput = {
  paneId: string;
  avatarId: string | null | undefined;
  sessionId: string | null | undefined;
};

export type ComposerDraftAttachment = {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  status: "ready";
  content: string;
  dataUrl?: string;
  sourcePath?: string;
  referenceToken?: boolean;
  composerRefLabel?: string;
  lineRange?: { start: number; end: number };
  spreadsheetRef?: { sheet: string; a1: string };
  snippetRef?: string;
  snippetContent?: string;
  htmlElementRef?: { tagName: string; selectorHint: string; comment?: string };
};

export type ComposerDraftQuote = {
  id: string;
  body: string;
  message: {
    id: string;
    role: "user" | "assistant" | "tool";
    content: string;
    avatarName?: string;
    avatarUrl?: string;
    agentId?: string;
  };
};

export type ComposerDraftRefMeta = {
  sourcePath?: string;
  composerRefLabel?: string;
  htmlElementRef?: { tagName: string; selectorHint: string; comment?: string };
};

export type ComposerDraft = {
  text: string;
  attachments: ComposerDraftAttachment[];
  quotes: ComposerDraftQuote[];
  refPaths: Record<string, string>;
  refMetaOverrides: Record<string, ComposerDraftRefMeta>;
  omittedAttachmentNames?: string[];
  updatedAt: number;
};

export type ComposerDraftCollection = {
  version: typeof COMPOSER_DRAFT_VERSION;
  drafts: Record<string, ComposerDraft>;
};

function emptyCollection(): ComposerDraftCollection {
  return { version: COMPOSER_DRAFT_VERSION, drafts: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function optionalString(value: unknown, max: number): string | undefined {
  const text = boundedString(value, max);
  return text ? text : undefined;
}

function finiteNonNegative(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function normalizeLineRange(value: unknown): { start: number; end: number } | undefined {
  if (!isRecord(value)) return undefined;
  const start = Math.floor(finiteNonNegative(value.start));
  const end = Math.floor(finiteNonNegative(value.end));
  if (start <= 0 || end < start) return undefined;
  return { start, end };
}

function normalizeSpreadsheetRef(value: unknown): { sheet: string; a1: string } | undefined {
  if (!isRecord(value)) return undefined;
  const sheet = boundedString(value.sheet, MAX_LABEL_CHARS);
  const a1 = boundedString(value.a1, MAX_LABEL_CHARS);
  return sheet && a1 ? { sheet, a1 } : undefined;
}

function normalizeHtmlElementRef(
  value: unknown,
): { tagName: string; selectorHint: string; comment?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const tagName = boundedString(value.tagName, MAX_LABEL_CHARS);
  const selectorHint = boundedString(value.selectorHint, MAX_PATH_CHARS);
  if (!tagName && !selectorHint) return undefined;
  return {
    tagName,
    selectorHint,
    ...(optionalString(value.comment, MAX_ATTACHMENT_CONTENT_CHARS)
      ? { comment: optionalString(value.comment, MAX_ATTACHMENT_CONTENT_CHARS) }
      : {}),
  };
}

function normalizeStringMap(
  value: unknown,
  valueLimit: number,
): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_REF_COUNT)) {
    const key = boundedString(rawKey, MAX_LABEL_CHARS);
    const item = boundedString(rawValue, valueLimit);
    if (key && item) result[key] = item;
  }
  return result;
}

function normalizeRefMetaMap(value: unknown): Record<string, ComposerDraftRefMeta> {
  if (!isRecord(value)) return {};
  const result: Record<string, ComposerDraftRefMeta> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, MAX_REF_COUNT)) {
    const key = boundedString(rawKey, MAX_LABEL_CHARS);
    if (!key || !isRecord(rawValue)) continue;
    const sourcePath = optionalString(rawValue.sourcePath, MAX_PATH_CHARS);
    const composerRefLabel = optionalString(rawValue.composerRefLabel, MAX_LABEL_CHARS);
    const htmlElementRef = normalizeHtmlElementRef(rawValue.htmlElementRef);
    if (!sourcePath && !composerRefLabel && !htmlElementRef) continue;
    result[key] = {
      ...(sourcePath ? { sourcePath } : {}),
      ...(composerRefLabel ? { composerRefLabel } : {}),
      ...(htmlElementRef ? { htmlElementRef } : {}),
    };
  }
  return result;
}

function normalizeQuote(value: unknown): ComposerDraftQuote | null {
  if (!isRecord(value) || !isRecord(value.message)) return null;
  const id = boundedString(value.id, MAX_LABEL_CHARS);
  const body = boundedString(value.body, MAX_QUOTE_CHARS);
  const messageId = boundedString(value.message.id, MAX_LABEL_CHARS);
  const role = value.message.role;
  if (
    !id ||
    !body ||
    !messageId ||
    (role !== "user" && role !== "assistant" && role !== "tool")
  ) {
    return null;
  }
  const avatarName = optionalString(value.message.avatarName, MAX_LABEL_CHARS);
  const avatarUrl = optionalString(value.message.avatarUrl, MAX_PATH_CHARS);
  const agentId = optionalString(value.message.agentId, MAX_LABEL_CHARS);
  return {
    id,
    body,
    message: {
      id: messageId,
      role,
      content: boundedString(value.message.content, MAX_QUOTE_CHARS),
      ...(avatarName ? { avatarName } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(agentId ? { agentId } : {}),
    },
  };
}

function normalizeAttachmentBase(value: unknown): ComposerDraftAttachment | null {
  if (!isRecord(value) || value.status !== "ready") return null;
  const key = boundedString(value.key, MAX_PATH_CHARS);
  const name = boundedString(value.name, MAX_LABEL_CHARS);
  if (!key || !name) return null;
  const sourcePath = optionalString(value.sourcePath, MAX_PATH_CHARS);
  const composerRefLabel = optionalString(value.composerRefLabel, MAX_LABEL_CHARS);
  const snippetRef = optionalString(value.snippetRef, MAX_PATH_CHARS);
  const snippetContent = optionalString(value.snippetContent, MAX_ATTACHMENT_CONTENT_CHARS);
  const lineRange = normalizeLineRange(value.lineRange);
  const spreadsheetRef = normalizeSpreadsheetRef(value.spreadsheetRef);
  const htmlElementRef = normalizeHtmlElementRef(value.htmlElementRef);
  return {
    key,
    name,
    size: finiteNonNegative(value.size),
    mimeType:
      boundedString(value.mimeType, MAX_LABEL_CHARS) || "application/octet-stream",
    status: "ready",
    content: boundedString(value.content, MAX_ATTACHMENT_CONTENT_CHARS),
    ...(sourcePath ? { sourcePath } : {}),
    ...(value.referenceToken === true ? { referenceToken: true } : {}),
    ...(composerRefLabel ? { composerRefLabel } : {}),
    ...(lineRange ? { lineRange } : {}),
    ...(spreadsheetRef ? { spreadsheetRef } : {}),
    ...(snippetRef ? { snippetRef } : {}),
    ...(snippetContent ? { snippetContent } : {}),
    ...(htmlElementRef ? { htmlElementRef } : {}),
  };
}

function normalizeOmittedNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .slice(0, MAX_ATTACHMENT_COUNT)
        .map((item) => boundedString(item, MAX_LABEL_CHARS))
        .filter(Boolean),
    ),
  );
}

export function normalizeComposerDraft(value: unknown, now = Date.now()): ComposerDraft | null {
  if (!isRecord(value)) return null;
  const omitted = normalizeOmittedNames(value.omittedAttachmentNames);
  const attachments: ComposerDraftAttachment[] = [];
  let inlineDataUrlChars = 0;
  const rawAttachments = Array.isArray(value.attachments)
    ? value.attachments.slice(0, MAX_ATTACHMENT_COUNT)
    : [];
  for (const raw of rawAttachments) {
    const attachment = normalizeAttachmentBase(raw);
    if (!attachment || !isRecord(raw)) continue;
    const rawDataUrl = boundedString(raw.dataUrl, COMPOSER_DRAFT_MAX_INLINE_DATA_URL_CHARS + 1);
    if (rawDataUrl) {
      if (attachment.sourcePath) {
        // Path-backed images can be reloaded through Electron; do not duplicate binary data.
      } else if (
        rawDataUrl.startsWith("data:") &&
        inlineDataUrlChars + rawDataUrl.length <= COMPOSER_DRAFT_MAX_INLINE_DATA_URL_CHARS
      ) {
        attachment.dataUrl = rawDataUrl;
        inlineDataUrlChars += rawDataUrl.length;
      } else {
        omitted.push(attachment.name);
        continue;
      }
    }
    attachments.push(attachment);
  }

  const quotes = (Array.isArray(value.quotes) ? value.quotes : [])
    .slice(0, MAX_QUOTE_COUNT)
    .map(normalizeQuote)
    .filter((item): item is ComposerDraftQuote => Boolean(item));
  const text = boundedString(value.text, MAX_TEXT_CHARS);
  const updatedAtRaw = finiteNonNegative(value.updatedAt);
  const updatedAt = updatedAtRaw > 0 ? updatedAtRaw : now;
  const omittedAttachmentNames = Array.from(new Set(omitted)).slice(0, MAX_ATTACHMENT_COUNT);
  const draft: ComposerDraft = {
    text,
    attachments,
    quotes,
    refPaths: normalizeStringMap(value.refPaths, MAX_PATH_CHARS),
    refMetaOverrides: normalizeRefMetaMap(value.refMetaOverrides),
    ...(omittedAttachmentNames.length > 0 ? { omittedAttachmentNames } : {}),
    updatedAt,
  };
  return isComposerDraftEmpty(draft) ? null : draft;
}

export function isComposerDraftEmpty(
  draft: Pick<ComposerDraft, "text" | "attachments" | "quotes" | "omittedAttachmentNames">,
): boolean {
  return (
    draft.text.trim().length === 0 &&
    draft.attachments.length === 0 &&
    draft.quotes.length === 0 &&
    (draft.omittedAttachmentNames?.length ?? 0) === 0
  );
}

export function composerDraftIdentity(input: ComposerDraftIdentityInput): string {
  const sessionId = String(input.sessionId ?? "").trim();
  if (sessionId) return `session:${sessionId}`;
  const paneId = encodeURIComponent(String(input.paneId ?? "").trim() || "unknown");
  const avatarId = input.avatarId == null
    ? "meta"
    : encodeURIComponent(String(input.avatarId).trim() || "meta");
  return `pane:${paneId}:avatar:${avatarId}`;
}

export function parseComposerDraftCollection(
  raw: string | null | undefined,
  now = Date.now(),
): ComposerDraftCollection {
  if (!raw) return emptyCollection();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== COMPOSER_DRAFT_VERSION || !isRecord(parsed.drafts)) {
      return emptyCollection();
    }
    const minimumUpdatedAt = now - COMPOSER_DRAFT_TTL_MS;
    const rows = Object.entries(parsed.drafts)
      .map(([identity, value]) => {
        const normalized = normalizeComposerDraft(value, now);
        if (!identity || !normalized || normalized.updatedAt < minimumUpdatedAt) return null;
        return [identity, normalized] as const;
      })
      .filter((item): item is readonly [string, ComposerDraft] => Boolean(item))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, COMPOSER_DRAFT_MAX_ENTRIES);
    return { version: COMPOSER_DRAFT_VERSION, drafts: Object.fromEntries(rows) };
  } catch {
    return emptyCollection();
  }
}

function serializeWithBudget(
  collection: ComposerDraftCollection,
  protectedIdentity?: string,
): string {
  const rows = Object.entries(collection.drafts)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, COMPOSER_DRAFT_MAX_ENTRIES);
  const drafts = Object.fromEntries(rows);
  let serialized = JSON.stringify({ version: COMPOSER_DRAFT_VERSION, drafts });
  if (serialized.length <= COMPOSER_DRAFT_MAX_STORE_CHARS) return serialized;

  const removable = rows
    .filter(([identity]) => identity !== protectedIdentity)
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  for (const [identity] of removable) {
    delete drafts[identity];
    serialized = JSON.stringify({ version: COMPOSER_DRAFT_VERSION, drafts });
    if (serialized.length <= COMPOSER_DRAFT_MAX_STORE_CHARS) return serialized;
  }

  const protectedDraft = protectedIdentity ? drafts[protectedIdentity] : undefined;
  if (protectedIdentity && protectedDraft) {
    const omitted = new Set(protectedDraft.omittedAttachmentNames ?? []);
    const attachments = protectedDraft.attachments.flatMap((attachment) => {
      if (attachment.dataUrl && !attachment.sourcePath) {
        omitted.add(attachment.name);
        return [];
      }
      return [{
        ...attachment,
        content: attachment.content.slice(0, 8_000),
        ...(attachment.snippetContent
          ? { snippetContent: attachment.snippetContent.slice(0, 8_000) }
          : {}),
      }];
    });
    const quotes = protectedDraft.quotes.map((quote) => ({
      ...quote,
      body: quote.body.slice(0, 8_000),
      message: { ...quote.message, content: quote.message.content.slice(0, 8_000) },
    }));
    const refPaths = Object.fromEntries(
      Object.entries(protectedDraft.refPaths).slice(0, 32),
    );
    const refMetaOverrides = Object.fromEntries(
      Object.entries(protectedDraft.refMetaOverrides)
        .slice(0, 32)
        .map(([key, meta]) => [
          key,
          {
            ...meta,
            ...(meta.htmlElementRef
              ? {
                  htmlElementRef: {
                    ...meta.htmlElementRef,
                    comment: meta.htmlElementRef.comment?.slice(0, 4_000),
                  },
                }
              : {}),
          },
        ]),
    );
    drafts[protectedIdentity] = {
      ...protectedDraft,
      attachments,
      quotes,
      refPaths,
      refMetaOverrides,
      ...(omitted.size > 0
        ? { omittedAttachmentNames: Array.from(omitted).slice(0, MAX_ATTACHMENT_COUNT) }
        : {}),
    };
    serialized = JSON.stringify({ version: COMPOSER_DRAFT_VERSION, drafts });
    if (serialized.length > COMPOSER_DRAFT_MAX_STORE_CHARS) {
      drafts[protectedIdentity] = {
        text: protectedDraft.text,
        attachments: [],
        quotes: [],
        refPaths: {},
        refMetaOverrides: {},
        omittedAttachmentNames: Array.from(
          new Set([
            ...(protectedDraft.omittedAttachmentNames ?? []),
            ...protectedDraft.attachments.map((attachment) => attachment.name),
          ]),
        ).slice(0, MAX_ATTACHMENT_COUNT),
        updatedAt: protectedDraft.updatedAt,
      };
      serialized = JSON.stringify({ version: COMPOSER_DRAFT_VERSION, drafts });
    }
  }
  return serialized;
}

export function readComposerDraftFromRaw(
  raw: string | null | undefined,
  identity: string,
  now = Date.now(),
): ComposerDraft | null {
  return parseComposerDraftCollection(raw, now).drafts[identity] ?? null;
}

export function writeComposerDraftToRaw(
  raw: string | null | undefined,
  identity: string,
  draft: Omit<ComposerDraft, "updatedAt"> & { updatedAt?: number },
  now = Date.now(),
): string {
  const collection = parseComposerDraftCollection(raw, now);
  const normalized = normalizeComposerDraft({ ...draft, updatedAt: now }, now);
  if (normalized) collection.drafts[identity] = normalized;
  else delete collection.drafts[identity];
  return serializeWithBudget(collection, identity);
}

export function removeComposerDraftFromRaw(
  raw: string | null | undefined,
  identity: string,
  now = Date.now(),
): string {
  const collection = parseComposerDraftCollection(raw, now);
  delete collection.drafts[identity];
  return serializeWithBudget(collection);
}

export function migrateComposerDraftInRaw(
  raw: string | null | undefined,
  fromIdentity: string,
  toIdentity: string,
  now = Date.now(),
): string {
  if (!fromIdentity || !toIdentity || fromIdentity === toIdentity) {
    return serializeWithBudget(parseComposerDraftCollection(raw, now), toIdentity);
  }
  const collection = parseComposerDraftCollection(raw, now);
  const source = collection.drafts[fromIdentity];
  const target = collection.drafts[toIdentity];
  if (source && (!target || source.updatedAt >= target.updatedAt)) {
    collection.drafts[toIdentity] = { ...source, updatedAt: now };
  }
  delete collection.drafts[fromIdentity];
  return serializeWithBudget(collection, toIdentity);
}

function readRawCollection(): string | null {
  return readScopedLocalStorage(COMPOSER_DRAFT_STORAGE_KEY);
}

function writeRawCollection(raw: string): void {
  writeScopedLocalStorage(COMPOSER_DRAFT_STORAGE_KEY, raw);
}

export function loadComposerDraft(identity: string): ComposerDraft | null {
  return readComposerDraftFromRaw(readRawCollection(), identity);
}

export function saveComposerDraft(
  identity: string,
  draft: Omit<ComposerDraft, "updatedAt"> & { updatedAt?: number },
): void {
  writeRawCollection(writeComposerDraftToRaw(readRawCollection(), identity, draft));
}

export function deleteComposerDraft(identity: string): void {
  writeRawCollection(removeComposerDraftFromRaw(readRawCollection(), identity));
}

export function migrateComposerDraft(fromIdentity: string, toIdentity: string): void {
  writeRawCollection(migrateComposerDraftInRaw(readRawCollection(), fromIdentity, toIdentity));
}
