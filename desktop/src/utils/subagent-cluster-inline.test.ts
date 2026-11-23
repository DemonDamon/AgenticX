import { describe, expect, it } from "vitest";
import {
  injectLiveSubAgentClusterAnchors,
  upsertLiveSubAgentClusterAnchor,
} from "./subagent-cluster-inline";
import type { Message } from "../store";

function toolSpawn(runId: string, clusterId: string, id = runId): Message {
  return {
    id,
    role: "tool",
    content: JSON.stringify({ ok: true, agent_id: runId, cluster_id: clusterId }),
    toolName: "spawn_subagent",
    toolCallId: `near-spawn-${runId}`,
    toolStatus: "done",
  };
}

describe("injectLiveSubAgentClusterAnchors", () => {
  it("synthesizes Agent 蜂群 card from spawn_subagent tool results", () => {
    const msgs: Message[] = [
      { id: "u1", role: "user", content: "spawn" },
      toolSpawn("cb-1", "cl-1"),
      toolSpawn("cb-2", "cl-1"),
    ];
    const out = injectLiveSubAgentClusterAnchors(msgs);
    const anchor = out.find((m) => m.subAgentCluster?.clusterId === "cl-1");
    expect(anchor).toBeTruthy();
    expect(anchor?.subAgentCluster?.runIds).toEqual(["cb-1", "cb-2"]);
    expect(anchor?.subAgentCluster?.title).toContain("Agent 蜂群");
  });
});

describe("upsertLiveSubAgentClusterAnchor", () => {
  it("inserts then merges run ids for the same cluster", () => {
    const once = upsertLiveSubAgentClusterAnchor([], {
      clusterId: "cl-9",
      runIds: ["a"],
      title: "Agent 蜂群 · 1 个并行任务",
    });
    expect(once).toHaveLength(1);
    const twice = upsertLiveSubAgentClusterAnchor(once, {
      clusterId: "cl-9",
      runIds: ["a", "b"],
    });
    expect(twice).toHaveLength(1);
    expect(twice[0].subAgentCluster?.runIds).toEqual(["a", "b"]);
  });
});
