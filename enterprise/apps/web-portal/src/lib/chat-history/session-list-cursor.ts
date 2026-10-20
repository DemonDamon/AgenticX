import type { ChatSessionListCursor } from "./types";

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const CURSOR_RE = /^[A-Za-z0-9_-]+$/;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function encodeSessionListCursor(cursor: ChatSessionListCursor): string {
  return Buffer.from(JSON.stringify([
    cursor.pinnedAt,
    cursor.createdAt,
    cursor.id,
  ])).toString("base64url");
}

export function decodeSessionListCursor(value: string): ChatSessionListCursor | null {
  if (value.length === 0 || value.length > 512 || !CURSOR_RE.test(value)) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 3) return null;
    const [pinnedAt, createdAt, id] = decoded;
    if (pinnedAt !== null && !isIsoDate(pinnedAt)) return null;
    if (!isIsoDate(createdAt) || typeof id !== "string" || !ULID_RE.test(id)) return null;
    return { pinnedAt, createdAt, id };
  } catch {
    return null;
  }
}
