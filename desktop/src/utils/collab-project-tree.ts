export type CollabTreeRoom = {
  id: string;
  title: string;
  parent_room_id?: string | null;
  room_kind: string;
};

export type RoomTreeNode = {
  room: CollabTreeRoom;
  children: RoomTreeNode[];
};

export type RoomTree = {
  trunk: RoomTreeNode[];
  directs: RoomTreeNode[];
};

function kindRank(kind: string): number {
  if (kind === "main") return 0;
  if (kind === "sub") return 1;
  return 2;
}

export function buildRoomTree(rooms: CollabTreeRoom[]): RoomTree {
  const directs = rooms.filter((room) => room.room_kind === "direct");
  const rest = rooms.filter((room) => room.room_kind !== "direct");
  const ids = new Set(rest.map((room) => room.id));
  const byParent = new Map<string, CollabTreeRoom[]>();
  for (const room of rest) {
    const parentId = room.parent_room_id && ids.has(room.parent_room_id) ? room.parent_room_id : "";
    const list = byParent.get(parentId) ?? [];
    list.push(room);
    byParent.set(parentId, list);
  }
  const toNode = (room: CollabTreeRoom): RoomTreeNode => ({
    room,
    children: (byParent.get(room.id) ?? []).map(toNode),
  });
  const trunk = (byParent.get("") ?? []).map(toNode);
  trunk.sort((a, b) => kindRank(a.room.room_kind) - kindRank(b.room.room_kind));
  return {
    trunk,
    directs: directs.map((room) => ({ room, children: [] })),
  };
}

export function flattenRoomTree(
  nodes: RoomTreeNode[],
  depth = 0,
): Array<{ room: CollabTreeRoom; depth: number }> {
  const rows: Array<{ room: CollabTreeRoom; depth: number }> = [];
  for (const node of nodes) {
    rows.push({ room: node.room, depth });
    rows.push(...flattenRoomTree(node.children, depth + 1));
  }
  return rows;
}
