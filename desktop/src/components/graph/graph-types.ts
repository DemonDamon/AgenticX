/** Types + pure helpers for Run Graph God-View (SP2 API contract). */

export type GraphNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "paused"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

export type GraphEdgeKind = "depends" | "message" | "artifact" | string;

export type GraphNodeSnapshot = {
  id: string;
  kind: string;
  label: string;
  status: GraphNodeStatus | string;
  agent_id?: string | null;
  task_text?: string;
  directives?: string[];
  view_role?: "task" | "agent";
  task_ids?: string[];
  meta?: Record<string, unknown>;
};

export type GraphEdgeSnapshot = {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  target: string;
  label?: string;
  meta?: Record<string, unknown>;
};

export type GraphProjection = {
  agent_nodes: GraphNodeSnapshot[];
  agent_edges: GraphEdgeSnapshot[];
};

export type ToolStep = {
  callId: string;
  toolName: string;
  phase: "calling" | "done";
  /** epoch ms of first observation */
  startedAt: number;
  updatedAt: number;
};

export type GraphRunSnapshot = {
  run_id: string;
  session_id: string;
  group_id?: string | null;
  status: string;
  version: number;
  nodes: Record<string, GraphNodeSnapshot>;
  edges: GraphEdgeSnapshot[];
  meta?: Record<string, unknown>;
};

export type GraphSsePayload = {
  type: string;
  run_id?: string;
  version?: number;
  status?: string;
  node?: GraphNodeSnapshot;
  edge?: GraphEdgeSnapshot;
  edge_id?: string;
  intensity?: number;
  summary?: string;
  node_ids?: string[];
  [key: string]: unknown;
};

export type InterveneOp =
  | "node_inject"
  | "node_retract"
  | "edge_reassign"
  | "selection_rule"
  | "pause"
  | "resume"
  | "cancel_node";

export type InterveneRequest = {
  op: InterveneOp;
  version: number;
  node_ids?: string[];
  edge_ids?: string[];
  payload?: Record<string, unknown>;
};

export type PaneGraphState = {
  runId: string | null;
  version: number;
  status: string;
  nodes: Record<string, GraphNodeSnapshot>;
  edges: GraphEdgeSnapshot[];
  projection: GraphProjection | null;
  /** edge ids that recently pulsed (for short dash animation) */
  pulseEdges: Record<string, number>;
  selectedNodeIds: string[];
  lastError: string | null;
  /** Live tool steps keyed by graph node id (e.g. agent:<avatar_id>). */
  toolStepsByNode: Record<string, ToolStep[]>;
};

export function emptyPaneGraphState(): PaneGraphState {
  return {
    runId: null,
    version: 0,
    status: "",
    nodes: {},
    edges: [],
    projection: null,
    pulseEdges: {},
    selectedNodeIds: [],
    lastError: null,
    toolStepsByNode: {},
  };
}

export function applyToolStepToState(
  state: PaneGraphState,
  nodeId: string,
  step: ToolStep,
): PaneGraphState {
  if (!nodeId || !step.callId) return state;
  const byNode = state.toolStepsByNode ?? {};
  const prev = byNode[nodeId] ?? [];
  const idx = prev.findIndex((s) => s.callId === step.callId);
  const next =
    idx >= 0
      ? prev.map((s, i) =>
          i === idx
            ? {
                ...s,
                phase: step.phase,
                toolName: step.toolName || s.toolName,
                updatedAt: step.updatedAt,
              }
            : s,
        )
      : [...prev, step];
  return { ...state, toolStepsByNode: { ...byNode, [nodeId]: next } };
}

/**
 * Stable empty snapshot for zustand selectors.
 * Never allocate a new object inside `useStore(s => ... ?? …)` — that breaks
 * useSyncExternalStore and causes "Maximum update depth exceeded".
 * Do not mutate this object; copy before writing.
 */
export const EMPTY_PANE_GRAPH_STATE: PaneGraphState = emptyPaneGraphState();

/** True when the run contains Workforce task nodes (not presence-only agent/human). */
export function graphHasTaskNodes(
  nodes: Record<string, GraphNodeSnapshot> | GraphNodeSnapshot[] | null | undefined,
): boolean {
  const list = Array.isArray(nodes) ? nodes : Object.values(nodes || {});
  return list.some((n) => String(n?.kind || "").toLowerCase() === "task");
}

/** Heuristic: retract vs inject from dock free text. */
export function classifyDirectiveText(text: string): "node_retract" | "node_inject" {
  const t = text.trim();
  if (/不用做|取消|别做|跳过/.test(t)) return "node_retract";
  return "node_inject";
}

export function buildInterveneBody(
  op: InterveneOp,
  version: number,
  opts: {
    nodeIds?: string[];
    edgeIds?: string[];
    payload?: Record<string, unknown>;
  } = {},
): InterveneRequest {
  return {
    op,
    version,
    node_ids: opts.nodeIds ?? [],
    edge_ids: opts.edgeIds ?? [],
    payload: opts.payload ?? {},
  };
}

export function applyGraphEvent(state: PaneGraphState, payload: GraphSsePayload): PaneGraphState {
  const type = String(payload.type || "");
  if (!type.startsWith("graph.")) return state;

  let next: PaneGraphState = { ...state, lastError: null };
  const runId = typeof payload.run_id === "string" ? payload.run_id : next.runId;
  if (runId) next = { ...next, runId };

  if (typeof payload.version === "number" && Number.isFinite(payload.version)) {
    next = { ...next, version: payload.version };
  }

  if (type === "graph.run_created") {
    return {
      ...next,
      status: "open",
      runId: runId || next.runId,
    };
  }

  if (type === "graph.run_status" && typeof payload.status === "string") {
    return { ...next, status: payload.status };
  }

  if (type === "graph.node_updated" && payload.node && typeof payload.node === "object") {
    const node = payload.node as GraphNodeSnapshot;
    const nodes = { ...next.nodes, [node.id]: { ...next.nodes[node.id], ...node } };
    return { ...next, nodes };
  }

  if (type === "graph.edge_updated" && payload.edge && typeof payload.edge === "object") {
    const edge = payload.edge as GraphEdgeSnapshot;
    const edges = next.edges.map((e) => (e.id === edge.id ? { ...e, ...edge } : e));
    if (!edges.some((e) => e.id === edge.id)) edges.push(edge);
    return { ...next, edges };
  }

  if (type === "graph.edge_removed") {
    const eid = String(
      payload.edge_id || (payload.edge as GraphEdgeSnapshot | undefined)?.id || "",
    ).trim();
    if (!eid) return next;
    return {
      ...next,
      edges: next.edges.filter((e) => e.id !== eid),
      projection: next.projection
        ? {
            ...next.projection,
            agent_edges: (next.projection.agent_edges || []).filter((e) => e.id !== eid),
          }
        : next.projection,
    };
  }

  if (type === "graph.edge_flow") {
    const eid = String(payload.edge_id || (payload.edge as GraphEdgeSnapshot | undefined)?.id || "");
    if (!eid) return next;
    return {
      ...next,
      pulseEdges: { ...next.pulseEdges, [eid]: Date.now() },
    };
  }

  if (type === "graph.intervention_applied") {
    return next;
  }

  return next;
}

export function applyGraphSnapshot(
  state: PaneGraphState,
  run: GraphRunSnapshot,
  projection?: GraphProjection | null,
): PaneGraphState {
  const nodesRaw = run.nodes || {};
  const nodes: Record<string, GraphNodeSnapshot> = {};
  for (const [id, n] of Object.entries(nodesRaw)) {
    nodes[id] = { ...n, id: n.id || id };
  }
  return {
    ...state,
    runId: run.run_id,
    version: Number(run.version) || 0,
    status: String(run.status || ""),
    nodes,
    edges: Array.isArray(run.edges) ? run.edges : [],
    projection: projection ?? state.projection,
    lastError: null,
  };
}

/** Simple column layout: pending | ready | running | blocked | done-ish */
export function layoutGraphNodes(
  nodes: GraphNodeSnapshot[],
): Record<string, { x: number; y: number }> {
  const columns: Record<string, number> = {
    pending: 0,
    ready: 1,
    running: 2,
    blocked: 2,
    paused: 2,
    done: 3,
    failed: 3,
    cancelled: 3,
    skipped: 3,
  };
  const counters: Record<number, number> = {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const col = columns[String(n.status)] ?? 0;
    const row = counters[col] ?? 0;
    counters[col] = row + 1;
    out[n.id] = { x: col * 220 + 24, y: row * 96 + 24 };
  }
  return out;
}

export const SELECTION_RULE_PRESETS = [
  { id: "fast", label: "快速出结论", text: "快速出结论，先收敛为一版可交付结论。" },
  { id: "draft", label: "先做一版", text: "先做一版，不必完美，优先可评审草稿。" },
  { id: "no-at", label: "停止互相 @", text: "停止互相 @，各自输出结论后由 Meta 汇总。" },
] as const;
