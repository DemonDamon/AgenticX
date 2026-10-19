import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendRoomMessages,
  enqueueOutbox,
  listOutbox,
  markOutboxFailed,
  maxCachedSeq,
  readProjectCache,
  readProjectsCache,
  readRoomMessages,
  removeOutbox,
  setCollabCacheRootForTests,
  writeProjectCache,
  writeProjectsCache,
  type OutboxItem,
} from "../electron/collab-cache";

const ROOM = "01R00M0AAAAAAAAAAAAAAAAAAA";
const PROJECT = "01PR0JECTAAAAAAAAAAAAAAAAA";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-collab-cache-"));
  setCollabCacheRootForTests(dir);
});

afterEach(() => {
  setCollabCacheRootForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("collab cache", () => {
  it("keeps a single row when the same seq is written twice", () => {
    appendRoomMessages(ROOM, [{ seq: 3, id: "a" }]);
    appendRoomMessages(ROOM, [{ seq: 3, id: "b" }]);
    const rows = readRoomMessages(ROOM);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seq).toBe(3);
    expect(maxCachedSeq(ROOM)).toBe(3);
    expect(maxCachedSeq("01EMPTY0AAAAAAAAAAAAAAAAAA")).toBe(0);
  });

  it("keeps only the newest 2000 room messages", () => {
    const batch = Array.from({ length: 2001 }, (_, index) => ({ seq: index + 1, id: `m${index + 1}` }));
    appendRoomMessages(ROOM, batch);
    const rows = readRoomMessages(ROOM, 5000);
    expect(rows).toHaveLength(2000);
    expect(rows[0]?.seq).toBe(2);
    expect(rows[rows.length - 1]?.seq).toBe(2001);
    expect(maxCachedSeq(ROOM)).toBe(2001);
  });

  it("rejects a room id that could escape the cache directory", () => {
    expect(() => appendRoomMessages("../etc/passwd", [])).toThrow(/invalid roomId/);
    expect(() => readRoomMessages("..", 1)).toThrow(/invalid roomId/);
    expect(() => maxCachedSeq("a/b")).toThrow(/invalid roomId/);
  });

  it("enqueues an outbox item, marks it failed, and removes it", () => {
    const item: OutboxItem = {
      client_msg_id: "c1",
      room_id: ROOM,
      content: "hi",
      created_at: 10,
      attempts: 0,
    };
    enqueueOutbox(item);
    expect(listOutbox(ROOM)).toEqual([item]);
    markOutboxFailed("c1", "offline");
    expect(listOutbox(ROOM)).toEqual([{ ...item, attempts: 1, last_error: "offline" }]);
    removeOutbox("c1");
    expect(listOutbox(ROOM)).toEqual([]);
    expect(() => enqueueOutbox({ ...item, room_id: "../x" })).toThrow(/invalid roomId/);
  });

  it("round-trips the project list and one project detail", () => {
    writeProjectsCache([{ id: PROJECT, name: "阿尔法" }]);
    const listed = readProjectsCache();
    expect(listed?.projects).toEqual([{ id: PROJECT, name: "阿尔法" }]);
    expect(typeof listed?.fetched_at).toBe("number");
    writeProjectCache(PROJECT, { project: { id: PROJECT, name: "阿尔法" }, rooms: [] });
    expect(readProjectCache(PROJECT)).toEqual({ project: { id: PROJECT, name: "阿尔法" }, rooms: [] });
    expect(readProjectCache("01MISSINGAAAAAAAAAAAAAAAAA")).toBeNull();
  });
});
