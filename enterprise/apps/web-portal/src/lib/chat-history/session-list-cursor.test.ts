import { describe, expect, it } from "vitest";
import { decodeSessionListCursor, encodeSessionListCursor } from "./session-list-cursor";

const cursor = {
  pinnedAt: "2026-09-20T11:12:13.000Z",
  createdAt: "2026-09-19T10:00:00.000Z",
  id: "01J00000000000000000000001",
};

describe("chat session list cursor", () => {
  it("round-trips a pinned or unpinned cursor", () => {
    expect(decodeSessionListCursor(encodeSessionListCursor(cursor))).toEqual(cursor);
    const unpinned = { ...cursor, pinnedAt: null };
    expect(decodeSessionListCursor(encodeSessionListCursor(unpinned))).toEqual(unpinned);
  });

  it("rejects malformed and non-canonical cursor data", () => {
    expect(decodeSessionListCursor("%%%")).toBeNull();
    expect(decodeSessionListCursor("a".repeat(513))).toBeNull();
    expect(decodeSessionListCursor(Buffer.from(JSON.stringify([
      null, "2026-09-19", cursor.id,
    ])).toString("base64url"))).toBeNull();
    expect(decodeSessionListCursor(Buffer.from(JSON.stringify([
      null, cursor.createdAt, "not-a-session-id",
    ])).toString("base64url"))).toBeNull();
  });
});
