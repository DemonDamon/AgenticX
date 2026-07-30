import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GraphNodeView, type GraphFlowNodeData } from "./GraphNodeView";
import {
  buildInterveneBody,
  layoutGraphNodes,
  type GraphEdgeSnapshot,
  type GraphNodeSnapshot,
  type InterveneRequest,
  type PaneGraphState,
} from "./graph-types";

const nodeTypes = { graphNode: GraphNodeView };

type Props = {
  state: PaneGraphState;
  preferAgentView: boolean;
  onSelectIds: (ids: string[]) => void;
  onIntervene: (body: InterveneRequest) => Promise<{ ok: boolean; warnings: string[] }>;
  onRequestForceReassign: (body: InterveneRequest) => void;
};

function toFlow(
  nodes: GraphNodeSnapshot[],
  edges: GraphEdgeSnapshot[],
  pulseEdges: Record<string, number>,
  selectedIds: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const positions = layoutGraphNodes(nodes);
  const flowNodes: Node[] = nodes.map((n) => ({
    id: n.id,
    type: "graphNode",
    position: positions[n.id] || { x: 0, y: 0 },
    selected: selectedIds.has(n.id),
    data: { node: n } satisfies GraphFlowNodeData,
  }));
  const now = Date.now();
  const flowEdges: Edge[] = edges.map((e) => {
    const pulsing = (pulseEdges[e.id] || 0) > now - 1200;
    const kind = String(e.kind || "depends");
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: pulsing || kind === "message",
      style: {
        stroke:
          kind === "message"
            ? "var(--text-subtle)"
            : kind === "artifact"
              ? "var(--ui-btn-primary-bg)"
              : "var(--border-strong)",
        strokeWidth: kind === "artifact" ? 2.2 : 1.4,
        strokeDasharray: kind === "message" ? "4 3" : undefined,
      },
      data: { kind, fromEdge: e.meta?.from_edge },
    };
  });
  return { nodes: flowNodes, edges: flowEdges };
}

function CanvasInner({
  state,
  preferAgentView,
  onSelectIds,
  onIntervene,
  onRequestForceReassign,
}: Props) {
  const viewNodes = useMemo(() => {
    if (preferAgentView && state.projection?.agent_nodes?.length) {
      return state.projection.agent_nodes;
    }
    return Object.values(state.nodes);
  }, [preferAgentView, state.nodes, state.projection]);

  const viewEdges = useMemo(() => {
    if (preferAgentView && state.projection?.agent_edges?.length) {
      return state.projection.agent_edges;
    }
    return state.edges;
  }, [preferAgentView, state.edges, state.projection]);

  const selectedSet = useMemo(() => new Set(state.selectedNodeIds), [state.selectedNodeIds]);
  const initial = useMemo(
    () => toFlow(viewNodes, viewEdges, state.pulseEdges, selectedSet),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync via effect below
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  useEffect(() => {
    const next = toFlow(viewNodes, viewEdges, state.pulseEdges, selectedSet);
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [viewNodes, viewEdges, state.pulseEdges, selectedSet, setNodes, setEdges]);

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      onSelectIds(params.nodes.map((n) => n.id));
    },
    [onSelectIds],
  );

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      // Reassign: dropping onto an agent node means change target task's agent.
      const targetId = connection.target;
      const isAgentTarget = targetId.startsWith("agent:");
      const newAgentId = isAgentTarget ? targetId.slice("agent:".length) : targetId;
      // Find a depends edge whose target is a selected task, or use meta.from_edge
      const fromEdge =
        state.edges.find((e) => e.target === connection.source)?.id ||
        state.edges.find((e) => String(e.kind) === "depends")?.id;
      const body = buildInterveneBody("edge_reassign", state.version, {
        edgeIds: fromEdge ? [fromEdge] : [],
        payload: {
          edge_id: fromEdge,
          new_agent_id: newAgentId,
        },
      });
      const result = await onIntervene(body);
      if (result.warnings.includes("target_running")) {
        onRequestForceReassign(
          buildInterveneBody("edge_reassign", state.version, {
            edgeIds: fromEdge ? [fromEdge] : [],
            payload: { edge_id: fromEdge, new_agent_id: newAgentId, force: true },
          }),
        );
        return;
      }
      if (result.ok) {
        setEdges((eds) => addEdge(connection, eds));
      }
    },
    [onIntervene, onRequestForceReassign, setEdges, state.edges, state.version],
  );

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    [],
  );

  const resolveTaskIds = (nodeId: string): string[] => {
    const n =
      viewNodes.find((x) => x.id === nodeId) ||
      state.nodes[nodeId] ||
      state.projection?.agent_nodes.find((x) => x.id === nodeId);
    if (!n) return [nodeId];
    if (Array.isArray(n.task_ids) && n.task_ids.length) return n.task_ids.map(String);
    return [n.id];
  };

  return (
    <div className="relative h-full w-full min-h-0">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => setCtxMenu(null)}
        selectionOnDrag
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="system"
      >
        <Background gap={18} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className="!bg-surface-card !border-border"
          maskColor="rgba(0,0,0,0.35)"
        />
      </ReactFlow>
      {ctxMenu ? (
        <div
          className="fixed z-[80] min-w-[140px] rounded-md border border-border bg-surface-card py-1 shadow-lg"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          {(
            [
              ["pause", "暂停节点"],
              ["resume", "恢复节点"],
              ["cancel_node", "取消节点"],
            ] as const
          ).map(([op, label]) => (
            <button
              key={op}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[12px] text-text-strong hover:bg-surface-hover"
              onClick={() => {
                const nodeIds = resolveTaskIds(ctxMenu.nodeId);
                void onIntervene(
                  buildInterveneBody(op, state.version, {
                    nodeIds,
                    payload: { scope: "node", node_ids: nodeIds },
                  }),
                );
                setCtxMenu(null);
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="block w-full px-3 py-1.5 text-left text-[12px] text-text-faint"
            disabled
            title="即将推出"
          >
            更多干预（即将推出）
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function RunGraphCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
