/**
 * Read persisted session messages from ~/.agenticx/sessions without waiting
 * for agx serve. Used by chat-pane bootstrap so a tiny on-disk tail is not
 * blocked behind studio cold-start / a synchronous session list.
 *
 * Author: Damon Li
 */

import fs from "node:fs";
import path from "node:path";

const SAFE_SESSION_ID = /^[A-Za-z0-9._:-]+$/;
const MESSAGES_JSON_TAIL = 40;

export type DiskSessionMessagesPage = {
  ok: true;
  messages: unknown[];
  start_index: number;
  total_count: number;
  has_older: boolean;
};

export type DiskSessionMessagesFull = {
  ok: true;
  messages: unknown[];
};

export function isSafeSessionId(sessionId: string): boolean {
  const sid = String(sessionId || "").trim();
  return Boolean(sid) && sid.length <= 128 && SAFE_SESSION_ID.test(sid) && !sid.includes("..");
}

export function resolveSessionDir(sessionsRoot: string, sessionId: string): string | null {
  if (!isSafeSessionId(sessionId)) return null;
  const root = path.resolve(sessionsRoot);
  const dir = path.resolve(root, sessionId);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (dir !== path.resolve(root, path.basename(dir))) return null;
  if (dir !== root && !dir.startsWith(prefix)) return null;
  return dir;
}

function parseMessagesArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const rec = data as { messages?: unknown; chat_history?: unknown };
    const inner = rec.messages ?? rec.chat_history;
    if (Array.isArray(inner)) return inner;
  }
  return null;
}

export function parseMessagesTailSnapshot(raw: string): DiskSessionMessagesPage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as { messages?: unknown; total_count?: unknown; start_index?: unknown };
  const messages = parseMessagesArray(obj.messages ?? data);
  if (!messages) return null;
  const totalCount = typeof obj.total_count === "number" ? obj.total_count : messages.length;
  const startIndex =
    typeof obj.start_index === "number"
      ? obj.start_index
      : Math.max(0, totalCount - messages.length);
  return {
    ok: true,
    messages,
    start_index: startIndex,
    total_count: totalCount,
    has_older: startIndex > 0,
  };
}

function readJsonFile(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function readSessionMessagesFromDisk(
  sessionsRoot: string,
  sessionId: string
): DiskSessionMessagesFull | null {
  const dir = resolveSessionDir(sessionsRoot, sessionId);
  if (!dir) return null;
  const parsed = parseMessagesArray(readJsonFile(path.join(dir, "messages.json")));
  if (!parsed) return null;
  return { ok: true, messages: parsed };
}

export function readSessionMessagesTailFromDisk(
  sessionsRoot: string,
  sessionId: string
): DiskSessionMessagesPage | null {
  const dir = resolveSessionDir(sessionsRoot, sessionId);
  if (!dir) return null;
  try {
    const tailPath = path.join(dir, "messages_tail.json");
    if (fs.existsSync(tailPath)) {
      const parsed = parseMessagesTailSnapshot(fs.readFileSync(tailPath, "utf8"));
      if (parsed) return parsed;
    }
  } catch {
    /* fall through to messages.json */
  }
  const full = readSessionMessagesFromDisk(sessionsRoot, sessionId);
  if (!full) return null;
  const total = full.messages.length;
  const start = Math.max(0, total - MESSAGES_JSON_TAIL);
  return {
    ok: true,
    messages: full.messages.slice(start),
    start_index: start,
    total_count: total,
    has_older: start > 0,
  };
}
