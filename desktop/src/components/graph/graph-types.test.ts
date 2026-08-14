import { describe, expect, it } from "vitest";
import {
  applyGraphEvent,
  applyGraphSnapshot,
  buildInterveneBody,
  classifyDirectiveText,
  emptyPaneGraphState,
  graphHasTaskNodes,
  layoutGraphNodes,
} from "./graph-types";

describe("graph-types", () => {
  it("graphHasTaskNodes is false for presence-only agent graphs", () => {
    expect(
      graphHasTaskNodes({
        human: { id: "human", kind: "human", label: "你", status: "ready" },
        "agent:a1": { id: "agent:a1", kind: "agent", label: "架构师·阿析", status: "ready" },
      }),
    ).toBe(false);
  });

  it("graphHasTaskNodes is true when workforce tasks exist", () => {
    expect(
      graphHasTaskNodes({
        t1: { id: "t1", kind: "task", label: "拆解", status: "ready" },
      }),
    ).toBe(true);
  });

  it("classifyDirectiveText detects retract phrases", () => {
    expect(classifyDirectiveText("这个不用做了")).toBe("node_retract");
    expect(classifyDirectiveText("请补充验收清单")).toBe("node_inject");
  });

  it("applyGraphEvent updates node status color path", () => {
    let s = emptyPaneGraphState();
    s = applyGraphEvent(s, {
      type: "graph.run_created",
      run_id: "gr_1",
      version: 1,
    });
    expect(s.runId).toBe("gr_1");
    s = applyGraphEvent(s, {
      type: "graph.node_updated",
      run_id: "gr_1",
      version: 2,
      node: { id: "n1", kind: "task", label: "实现", status: "running", agent_id: "a1" },
    });
    expect(s.nodes.n1?.status).toBe("running");
    expect(s.version).toBe(2);
  });

  it("applyGraphEvent records edge_flow pulse", () => {
    let s = emptyPaneGraphState();
    s = applyGraphEvent(s, { type: "graph.edge_flow", run_id: "gr_1", edge_id: "e1" });
    expect(s.pulseEdges.e1).toBeGreaterThan(0);
  });

  it("applyGraphEvent removes edges on edge_removed", () => {
    let s = emptyPaneGraphState();
    s = {
      ...s,
      edges: [
        { id: "msg_human_agent:a1", kind: "message", source: "human", target: "agent:a1" },
        { id: "msg_human_agent:__meta__", kind: "message", source: "human", target: "agent:__meta__" },
      ],
      projection: {
        agent_nodes: [],
        agent_edges: [
          { id: "msg_human_agent:a1", kind: "message", source: "human", target: "agent:a1" },
        ],
      },
    };
    s = applyGraphEvent(s, {
      type: "graph.edge_removed",
      run_id: "gr_1",
      edge_id: "msg_human_agent:a1",
    });
    expect(s.edges.map((e) => e.id)).toEqual(["msg_human_agent:__meta__"]);
    expect(s.projection?.agent_edges).toEqual([]);
  });

  it("applyGraphSnapshot replaces nodes/edges", () => {
    const s = applyGraphSnapshot(emptyPaneGraphState(), {
      run_id: "gr_2",
      session_id: "s",
      status: "open",
      version: 4,
      nodes: {
        t1: { id: "t1", kind: "task", label: "A", status: "ready" },
      },
      edges: [{ id: "e1", kind: "depends", source: "t1", target: "t1" }],
    }, { agent_nodes: [], agent_edges: [] });
    expect(s.version).toBe(4);
    expect(s.nodes.t1?.label).toBe("A");
    expect(s.projection?.agent_nodes).toEqual([]);
  });

  it("buildInterveneBody shapes edge_reassign", () => {
    const body = buildInterveneBody("edge_reassign", 3, {
      edgeIds: ["e_dep"],
      payload: { edge_id: "e_dep", new_agent_id: "avatar_b" },
    });
    expect(body).toEqual({
      op: "edge_reassign",
      version: 3,
      node_ids: [],
      edge_ids: ["e_dep"],
      payload: { edge_id: "e_dep", new_agent_id: "avatar_b" },
    });
  });

  it("layoutGraphNodes columns by status", () => {
    const pos = layoutGraphNodes([
      { id: "a", kind: "task", label: "a", status: "pending" },
      { id: "b", kind: "task", label: "b", status: "running" },
      { id: "c", kind: "task", label: "c", status: "done" },
    ]);
    expect(pos.a.x).toBeLessThan(pos.b.x);
    expect(pos.b.x).toBeLessThan(pos.c.x);
  });
});
