import type { Message } from "../store";

const SPAWN_TOOLS = new Set(["spawn_subagent", "delegate_to_avatar"]);

type LiveClusterAcc = {
  clusterId: string;
  runIds: string[];
  lastIndex: number;
  ownerSessionId?: string;
};

/** Parse `{ok, agent_id/delegation_id, cluster_id}` from a spawn/delegate tool result body. */
function parseSpawnClusterRef(content: unknown): { clusterId: string; runId: string } | null {
  const raw = String(content ?? "").trim();
  if (!raw || raw[0] !== "{") return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj.ok !== true) return null;
    const clusterId = String(obj.cluster_id ?? "").trim();
    const runId = String(obj.agent_id ?? obj.delegation_id ?? "").trim();
    if (!clusterId || !runId) return null;
    return { clusterId, runId };
  } catch {
    return null;
  }
}

/**
 * During a live turn the cluster anchor is persisted to messages.json on the
 * backend but never streamed to the client, so the inline cluster card would
 * only surface after a reload. Synthesize an inline anchor row from the
 * spawn/delegate tool-result messages already present in the stream so the
 * cluster card renders inline in the conversation immediately, mirroring the
 * clarification-card pattern. Deduped by clusterId against any persisted anchor
 * so the live and persisted views converge to a single card.
 */
export function injectLiveSubAgentClusterAnchors(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;

  const anchoredClusterIds = new Set<string>();
  for (const m of messages) {
    const cid = m.subAgentCluster?.clusterId;
    if (cid) anchoredClusterIds.add(cid);
  }

  const clusters = new Map<string, LiveClusterAcc>();
  messages.forEach((m, index) => {
    if (m.role !== "tool") return;
    if (!SPAWN_TOOLS.has((m.toolName ?? "").trim())) return;
    const ref = parseSpawnClusterRef(m.content);
    if (!ref) return;
    if (anchoredClusterIds.has(ref.clusterId)) return;
    let acc = clusters.get(ref.clusterId);
    if (!acc) {
      acc = { clusterId: ref.clusterId, runIds: [], lastIndex: index, ownerSessionId: m.ownerSessionId };
      clusters.set(ref.clusterId, acc);
    }
    if (!acc.runIds.includes(ref.runId)) acc.runIds.push(ref.runId);
    acc.lastIndex = index;
  });

  if (clusters.size === 0) return messages;

  const insertAfter = new Map<number, LiveClusterAcc[]>();
  for (const acc of clusters.values()) {
    const list = insertAfter.get(acc.lastIndex) ?? [];
    list.push(acc);
    insertAfter.set(acc.lastIndex, list);
  }

  const out: Message[] = [];
  messages.forEach((m, index) => {
    out.push(m);
    const accs = insertAfter.get(index);
    if (!accs) return;
    for (const acc of accs) {
      out.push({
        id: `cluster-anchor-live:${acc.clusterId}`,
        role: "assistant",
        content: "",
        ownerSessionId: acc.ownerSessionId,
        subAgentCluster: {
          clusterId: acc.clusterId,
          runIds: acc.runIds,
          title: `Agent 蜂群 · ${acc.runIds.length} 个并行任务`,
        },
      });
    }
  });
  return out;
}
