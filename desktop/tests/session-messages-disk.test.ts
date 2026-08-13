import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isSafeSessionId,
  parseMessagesTailSnapshot,
  readSessionMessagesFromDisk,
  readSessionMessagesTailFromDisk,
  resolveSessionDir,
} from "../electron/session-messages-disk";

const SID = "aa272f90-b9eb-456b-97d5-427330dace3f";

describe("isSafeSessionId", () => {
  it("accepts uuid and im-prefixed ids", () => {
    expect(isSafeSessionId(SID)).toBe(true);
    expect(isSafeSessionId("im-abc_def:1")).toBe(true);
  });

  it("rejects traversal and empty ids", () => {
    expect(isSafeSessionId("")).toBe(false);
    expect(isSafeSessionId("../etc")).toBe(false);
    expect(isSafeSessionId("foo/bar")).toBe(false);
    expect(isSafeSessionId("foo\\bar")).toBe(false);
  });
});

describe("resolveSessionDir", () => {
  it("stays under the sessions root", () => {
    const root = path.join(os.tmpdir(), "agx-sessions-root");
    expect(resolveSessionDir(root, SID)).toBe(path.resolve(root, SID));
    expect(resolveSessionDir(root, "../escape")).toBeNull();
  });
});

describe("parseMessagesTailSnapshot", () => {
  it("reads the studio tail snapshot shape", () => {
    const parsed = parseMessagesTailSnapshot(
      JSON.stringify({
        total_count: 2,
        start_index: 0,
        messages: [
          { role: "user", content: "在吗" },
          { role: "assistant", content: "在的" },
        ],
      })
    );
    expect(parsed).toEqual({
      ok: true,
      start_index: 0,
      total_count: 2,
      has_older: false,
      messages: [
        { role: "user", content: "在吗" },
        { role: "assistant", content: "在的" },
      ],
    });
  });

  it("marks has_older when the window does not start at 0", () => {
    const parsed = parseMessagesTailSnapshot(
      JSON.stringify({
        total_count: 50,
        start_index: 10,
        messages: [{ role: "user", content: "later" }],
      })
    );
    expect(parsed?.has_older).toBe(true);
    expect(parsed?.start_index).toBe(10);
  });

  it("returns null on invalid json", () => {
    expect(parseMessagesTailSnapshot("not-json")).toBeNull();
  });
});

describe("readSessionMessagesTailFromDisk", () => {
  it("returns the tail snapshot without needing messages.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agx-session-disk-"));
    try {
      const dir = path.join(tmp, SID);
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "messages_tail.json"),
        JSON.stringify({
          total_count: 2,
          start_index: 0,
          messages: [{ role: "user", content: "在吗" }],
        }),
        "utf8"
      );
      const page = readSessionMessagesTailFromDisk(tmp, SID);
      expect(page?.ok).toBe(true);
      expect(page?.messages).toHaveLength(1);
      expect(page?.has_older).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("falls back to the last messages.json rows when tail is missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agx-session-disk-"));
    try {
      const dir = path.join(tmp, SID);
      fs.mkdirSync(dir);
      const rows = Array.from({ length: 45 }, (_, i) => ({
        role: "user",
        content: `m${i}`,
      }));
      fs.writeFileSync(path.join(dir, "messages.json"), JSON.stringify(rows), "utf8");
      const page = readSessionMessagesTailFromDisk(tmp, SID);
      expect(page?.messages).toHaveLength(40);
      expect(page?.start_index).toBe(5);
      expect(page?.has_older).toBe(true);
      expect(page?.total_count).toBe(45);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null when the session directory does not exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agx-session-disk-"));
    try {
      expect(readSessionMessagesTailFromDisk(tmp, SID)).toBeNull();
      expect(readSessionMessagesFromDisk(tmp, SID)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
