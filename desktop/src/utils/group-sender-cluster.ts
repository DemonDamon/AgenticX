/**
 * Group-chat sender keys so consecutive bubbles cluster by person, not left/right.
 * Author: Damon Li
 */

export type GroupSenderCluster = {
  senderKey: string | null;
  clusterContinue: boolean;
};

export function groupSenderClusterKey(
  message: {
    role?: string;
    agentId?: string;
    avatarName?: string;
    speakerUserId?: string;
    systemNotice?: boolean;
  },
  senderAvatarId?: string,
): string | null {
  if (message.systemNotice) return null;
  if (message.role === "user") {
    const peer = String(message.speakerUserId ?? "").trim();
    return peer ? `user:${peer}` : "user:self";
  }
  if (message.role !== "assistant") return null;
  const id = String(senderAvatarId ?? "").trim() || String(message.agentId ?? "").trim();
  if (id) return `assistant:${id}`;
  const name = String(message.avatarName ?? "").trim();
  if (name && name !== "分身") return `assistant:name:${name}`;
  return null;
}

export function clusterFlagsForGroupRows<T extends { id: string }>(
  rows: Array<{ kind: string; message?: T }>,
  resolveKey: (message: T) => string | null,
): Map<string, GroupSenderCluster> {
  const out = new Map<string, GroupSenderCluster>();
  let prevKey: string | null = null;
  for (const row of rows) {
    if (row.kind !== "message" || !row.message) {
      prevKey = null;
      continue;
    }
    const key = resolveKey(row.message);
    out.set(row.message.id, {
      senderKey: key,
      clusterContinue: Boolean(key && prevKey && key === prevKey),
    });
    prevKey = key;
  }
  return out;
}

export function lastAdjacentClusterKey<T extends { id: string }>(
  flags: Map<string, GroupSenderCluster>,
  rows: Array<{ kind: string; message?: T }>,
): string | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  if (last.kind !== "message" || !last.message) return null;
  return flags.get(last.message.id)?.senderKey ?? null;
}
