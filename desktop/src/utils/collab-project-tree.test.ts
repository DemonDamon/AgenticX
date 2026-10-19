import { describe, expect, it } from "vitest";
import { buildRoomTree } from "./collab-project-tree";

describe("buildRoomTree", () => {
  it("puts the main room first, nests sub rooms by parent, and groups directs", () => {
    const tree = buildRoomTree([
      { id: "s1", title: "小群", parent_room_id: "m", room_kind: "sub" },
      { id: "d1", title: "单聊", parent_room_id: "m", room_kind: "direct" },
      { id: "orphan", title: "游离", parent_room_id: null, room_kind: "sub" },
      { id: "m", title: "主群", parent_room_id: null, room_kind: "main" },
      { id: "s2", title: "小小群", parent_room_id: "s1", room_kind: "sub" },
    ]);

    expect(tree.trunk.map((node) => node.room.id)).toEqual(["m", "orphan"]);
    expect(tree.trunk[0]?.room.room_kind).toBe("main");
    expect(tree.trunk[0]?.children.map((node) => node.room.id)).toEqual(["s1"]);
    expect(tree.trunk[0]?.children[0]?.children.map((node) => node.room.id)).toEqual(["s2"]);
    expect(tree.directs.map((node) => node.room.id)).toEqual(["d1"]);
    expect(tree.trunk.some((node) => node.room.room_kind === "direct")).toBe(false);
    expect(tree.trunk[0]?.children.some((node) => node.room.room_kind === "direct")).toBe(false);
  });
});
