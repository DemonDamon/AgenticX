import fs from "node:fs";
import path from "node:path";

import { agxHomePath } from "./agx-home";

const ID_RE = /^[0-9A-Za-z]{26}$/;
const ROOM_KEEP = 2000;
const ROOM_READ_DEFAULT = 500;

export type CachedRoomMessage = Record<string, unknown> & { seq: number };

export type OutboxItem = {
  client_msg_id: string;
  room_id: string;
  content: string;
  created_at: number;
  attempts: number;
  last_error?: string;
};

export type CachedProjectDetail = {
  project: { id: string };
  rooms: unknown[];
};

let cacheRootOverride: string | null = null;

export function setCollabCacheRootForTests(root: string | null): void {
  cacheRootOverride = root;
}

function cacheRoot(): string {
  if (cacheRootOverride && cacheRootOverride.trim()) return cacheRootOverride;
  return agxHomePath("collab-cache");
}

function assertId(id: string, label: string): string {
  const value = id.trim();
  if (!ID_RE.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function atomicWrite(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

function projectsFile(): string {
  return path.join(cacheRoot(), "projects.json");
}

function projectFile(projectId: string): string {
  return path.join(cacheRoot(), "projects", `${assertId(projectId, "projectId")}.json`);
}

function roomFile(roomId: string): string {
  return path.join(cacheRoot(), "rooms", `${assertId(roomId, "roomId")}.jsonl`);
}

function outboxFile(): string {
  return path.join(cacheRoot(), "outbox.jsonl");
}

export function isCachedRoomMessage(value: unknown): value is CachedRoomMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const seq = (value as { seq?: unknown }).seq;
  return typeof seq === "number" && Number.isFinite(seq);
}

export function isCachedProjectDetail(value: unknown): value is CachedProjectDetail {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as { project?: unknown; rooms?: unknown };
  if (!row.project || typeof row.project !== "object" || Array.isArray(row.project)) return false;
  if (typeof (row.project as { id?: unknown }).id !== "string") return false;
  return Array.isArray(row.rooms);
}

export function readProjectsCache(): { projects: unknown[]; fetched_at: number } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectsFile(), "utf8")) as {
      projects?: unknown;
      fetched_at?: unknown;
    };
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.projects)) return null;
    if (typeof parsed.fetched_at !== "number") return null;
    return { projects: parsed.projects, fetched_at: parsed.fetched_at };
  } catch {
    return null;
  }
}

export function writeProjectsCache(projects: unknown[]): void {
  atomicWrite(projectsFile(), JSON.stringify({ projects, fetched_at: Date.now() }));
}

export function readProjectCache(projectId: string): unknown | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectFile(projectId), "utf8")) as {
      data?: unknown;
      fetched_at?: unknown;
    };
    if (!parsed || typeof parsed !== "object" || typeof parsed.fetched_at !== "number") return null;
    if (!("data" in parsed)) return null;
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid ")) throw error;
    return null;
  }
}

export function writeProjectCache(projectId: string, detail: unknown): void {
  atomicWrite(projectFile(projectId), JSON.stringify({ fetched_at: Date.now(), data: detail }));
}

function readAllRoomMessages(roomId: string): CachedRoomMessage[] {
  let text = "";
  try {
    text = fs.readFileSync(roomFile(roomId), "utf8");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid ")) throw error;
    return [];
  }
  const bySeq = new Map<number, CachedRoomMessage>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isCachedRoomMessage(parsed)) continue;
      bySeq.set(parsed.seq, parsed);
    } catch {
      /* skip corrupt line */
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function writeRoomMessages(roomId: string, messages: CachedRoomMessage[]): void {
  const body = messages.map((message) => JSON.stringify(message)).join("\n");
  atomicWrite(roomFile(roomId), body.length > 0 ? `${body}\n` : "");
}

export function readRoomMessages(roomId: string, limit = ROOM_READ_DEFAULT): CachedRoomMessage[] {
  const all = readAllRoomMessages(roomId);
  const count = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (all.length <= count) return all;
  return all.slice(all.length - count);
}

export function appendRoomMessages(roomId: string, messages: CachedRoomMessage[]): void {
  const bySeq = new Map<number, CachedRoomMessage>();
  for (const message of readAllRoomMessages(roomId)) bySeq.set(message.seq, message);
  for (const message of messages) {
    if (!isCachedRoomMessage(message)) continue;
    bySeq.set(message.seq, message);
  }
  let merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  if (merged.length > ROOM_KEEP) merged = merged.slice(merged.length - ROOM_KEEP);
  writeRoomMessages(roomId, merged);
}

export function maxCachedSeq(roomId: string): number {
  const all = readAllRoomMessages(roomId);
  if (all.length === 0) return 0;
  return all[all.length - 1]?.seq ?? 0;
}

function readOutboxItems(): OutboxItem[] {
  let text = "";
  try {
    text = fs.readFileSync(outboxFile(), "utf8");
  } catch {
    return [];
  }
  const items: OutboxItem[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<OutboxItem>;
      if (!parsed || typeof parsed.client_msg_id !== "string" || typeof parsed.room_id !== "string") continue;
      const item: OutboxItem = {
        client_msg_id: parsed.client_msg_id,
        room_id: parsed.room_id,
        content: typeof parsed.content === "string" ? parsed.content : "",
        created_at: typeof parsed.created_at === "number" ? parsed.created_at : 0,
        attempts: typeof parsed.attempts === "number" ? parsed.attempts : 0,
      };
      if (typeof parsed.last_error === "string") item.last_error = parsed.last_error;
      items.push(item);
    } catch {
      /* skip corrupt line */
    }
  }
  return items;
}

function writeOutboxItems(items: OutboxItem[]): void {
  const body = items.map((item) => JSON.stringify(item)).join("\n");
  atomicWrite(outboxFile(), body.length > 0 ? `${body}\n` : "");
}

export function enqueueOutbox(item: OutboxItem): void {
  assertId(item.room_id, "roomId");
  if (!item.client_msg_id.trim()) throw new Error("invalid client_msg_id");
  const items = readOutboxItems();
  const index = items.findIndex((row) => row.client_msg_id === item.client_msg_id);
  if (index >= 0) {
    const prev = items[index];
    if (!prev) return;
    items[index] = { ...item, created_at: prev.created_at };
  } else {
    items.push(item);
  }
  writeOutboxItems(items);
}

export function listOutbox(roomId?: string): OutboxItem[] {
  if (roomId !== undefined) assertId(roomId, "roomId");
  const items = readOutboxItems();
  if (!roomId) return items;
  return items.filter((item) => item.room_id === roomId);
}

export function removeOutbox(clientMsgId: string): void {
  const items = readOutboxItems().filter((item) => item.client_msg_id !== clientMsgId);
  writeOutboxItems(items);
}

export function markOutboxFailed(clientMsgId: string, error: string): void {
  const items = readOutboxItems();
  const index = items.findIndex((item) => item.client_msg_id === clientMsgId);
  if (index < 0) return;
  const current = items[index];
  if (!current) return;
  items[index] = { ...current, attempts: current.attempts + 1, last_error: error };
  writeOutboxItems(items);
}
