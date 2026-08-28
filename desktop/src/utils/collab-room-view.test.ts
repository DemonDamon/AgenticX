import { describe, expect, it } from "vitest";
import {
  bubbleKind,
  firstScreenAfterSeq,
  membersChanged,
  nextCursor,
  statusLabel,
  upsertBySeq,
  visibleContent,
  type RoomMember,
  type RoomMessage,
} from "./collab-room-view";

function msg(partial: Partial<RoomMessage> & Pick<RoomMessage, "id" | "seq">): RoomMessage {
  return {
    room_id: "01R00M0AAAAAAAAAAAAAAAAAAA",
    sender_type: "human",
    sender_id: "u1",
    sender_name: "Bob",
    content: "hi",
    ...partial,
  };
}

describe("collab-room-view", () => {
  it("firstScreenAfterSeq keeps the last N messages", () => {
    expect(firstScreenAfterSeq(350, 100)).toBe(250);
    expect(firstScreenAfterSeq(30, 100)).toBe(0);
    expect(firstScreenAfterSeq(0, 100)).toBe(0);
  });

  it("upsertBySeq replaces by id and sorts by seq", () => {
    const first = upsertBySeq([], msg({ id: "a", seq: 3 }));
    const next = upsertBySeq(first, msg({ id: "b", seq: 1 }));
    expect(next.map((item) => item.seq)).toEqual([1, 3]);
    const replaced = upsertBySeq(next, msg({ id: "a", seq: 3, content: "updated" }));
    expect(replaced).toHaveLength(2);
    expect(replaced.find((item) => item.id === "a")?.content).toBe("updated");
  });

  it("upsertBySeq replaces an optimistic message by id", () => {
    const withTemp = upsertBySeq([], msg({ id: "temp-1", seq: Number.MAX_SAFE_INTEGER }));
    const replaced = upsertBySeq(withTemp, msg({ id: "temp-1", seq: 9, content: "server" }));
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.seq).toBe(9);
    expect(replaced[0]?.content).toBe("server");
  });

  it("nextCursor returns the max seq", () => {
    expect(nextCursor([msg({ id: "a", seq: 2 }), msg({ id: "b", seq: 5 })])).toBe(5);
    expect(nextCursor([])).toBe(0);
    expect(nextCursor([msg({ id: "temp-1", seq: Number.MAX_SAFE_INTEGER })])).toBe(0);
  });

  it("bubbleKind marks my own messages as self", () => {
    expect(bubbleKind(msg({ id: "a", seq: 1, sender_id: "me" }), "me")).toBe("self");
  });

  it("bubbleKind marks meta and system first", () => {
    expect(
      bubbleKind(msg({ id: "a", seq: 1, sender_type: "meta", sender_id: "me" }), "me"),
    ).toBe("meta");
    expect(
      bubbleKind(msg({ id: "b", seq: 2, sender_type: "system", sender_id: "me" }), "me"),
    ).toBe("system");
  });

  it("visibleContent strips think blocks", () => {
    expect(visibleContent("<think>推理</think>\n对外")).toBe("对外");
  });

  it("visibleContent falls back when everything is a think block", () => {
    expect(visibleContent("<think>只有推理</think>")).toBe("<think>只有推理</think>");
  });

  it("statusLabel maps revoked to a removal notice", () => {
    expect(statusLabel("revoked")).toBe("你已被移出该房间");
  });

  it("membersChanged detects a newly added member", () => {
    const meta: RoomMember = {
      id: "m1",
      member_type: "meta",
      member_id: "meta",
      display_name: "Meta",
      room_role: "member",
    };
    const admin: RoomMember = {
      id: "m2",
      member_type: "human",
      member_id: "u-admin",
      display_name: "admin@agenticx.local",
      room_role: "owner",
    };
    const alice: RoomMember = {
      id: "m3",
      member_type: "human",
      member_id: "u-alice2",
      display_name: "alice2",
      room_role: "member",
    };
    expect(membersChanged([meta, admin], [meta, admin])).toBe(false);
    expect(membersChanged([meta, admin], [meta, admin, alice])).toBe(true);
  });
});
