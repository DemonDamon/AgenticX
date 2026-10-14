import { describe, expect, it } from "vitest";
import { findMentionedAgents } from "../agent-mentions";
import type { CollabRoomMember } from "../types";

function agent(
  partial: Partial<CollabRoomMember> & Pick<CollabRoomMember, "member_id" | "display_name">,
): CollabRoomMember {
  return {
    id: `m-${partial.member_id}`,
    room_id: "room",
    member_type: "agent",
    room_role: "member",
    joined_at: "2026-10-14T00:00:00.000Z",
    ...partial,
  };
}

describe("findMentionedAgents", () => {
  it("matches an agent slug", () => {
    const members = [agent({ member_id: "a1", display_name: "验收助手" })];
    const slugs = new Map([["a1", "report-bot"]]);
    const hit = findMentionedAgents("请 @report-bot 介绍你自己", members, slugs);
    expect(hit.map((item) => item.member_id)).toEqual(["a1"]);
    expect(findMentionedAgents("@Report-Bot", members, slugs).map((item) => item.member_id)).toEqual(["a1"]);
  });

  it("matches a Chinese display name", () => {
    const members = [agent({ member_id: "a1", display_name: "验收助手" })];
    expect(findMentionedAgents("@验收助手 你好", members).map((item) => item.member_id)).toEqual(["a1"]);
    expect(findMentionedAgents("（@验收助手）", members).map((item) => item.member_id)).toEqual(["a1"]);
  });

  it("does not treat an email as a mention", () => {
    const members = [agent({ member_id: "a1", display_name: "x" })];
    const slugs = new Map([["a1", "x"]]);
    expect(findMentionedAgents("write me at email@x today", members, slugs)).toEqual([]);
    expect(findMentionedAgents("a@x.com", members, slugs)).toEqual([]);
  });

  it("ignores an agent who already left the room", () => {
    const members = [
      agent({
        member_id: "a1",
        display_name: "验收助手",
        left_at: "2026-10-14T01:00:00.000Z",
      }),
    ];
    const slugs = new Map([["a1", "report-bot"]]);
    expect(findMentionedAgents("@验收助手 @report-bot", members, slugs)).toEqual([]);
  });

  it("dedupes, keeps first-seen order, and stops at 3", () => {
    const members = [1, 2, 3, 4].map((index) =>
      agent({ member_id: `a${index}`, display_name: `bot${index}` }),
    );
    const ids = findMentionedAgents("@bot2 hi @bot1 @bot2 @bot4 @bot3", members).map(
      (item) => item.member_id,
    );
    expect(ids).toEqual(["a2", "a1", "a4"]);
  });

  it("does not treat @meta as an agent mention", () => {
    const members = [agent({ member_id: "a1", display_name: "验收助手" })];
    expect(findMentionedAgents("@meta 总结一下", members)).toEqual([]);
  });
});
