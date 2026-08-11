import { create } from "zustand";
import {
  applyGraphEvent,
  applyGraphSnapshot,
  applyToolStepToState,
  EMPTY_PANE_GRAPH_STATE,
  emptyPaneGraphState,
  type GraphProjection,
  type GraphRunSnapshot,
  type GraphSsePayload,
  type InterveneRequest,
  type PaneGraphState,
  type ToolStep,
} from "./graph-types";

type GraphRunStore = {
  byPane: Record<string, PaneGraphState>;
  applyEvent: (paneId: string, payload: GraphSsePayload) => void;
  applySnapshot: (
    paneId: string,
    run: GraphRunSnapshot,
    projection?: GraphProjection | null,
  ) => void;
  applyToolStep: (paneId: string, nodeId: string, step: ToolStep) => void;
  setSelected: (paneId: string, nodeIds: string[]) => void;
  resetPane: (paneId: string) => void;
  getPane: (paneId: string) => PaneGraphState;
};

/** Read/write path: return existing or a fresh mutable copy (never the shared EMPTY). */
function ensureMutable(state: GraphRunStore["byPane"], paneId: string): PaneGraphState {
  return state[paneId] ?? emptyPaneGraphState();
}

export const useGraphRunStore = create<GraphRunStore>((set, get) => ({
  byPane: {},
  applyEvent: (paneId, payload) =>
    set((s) => ({
      byPane: {
        ...s.byPane,
        [paneId]: applyGraphEvent(ensureMutable(s.byPane, paneId), payload),
      },
    })),
  applySnapshot: (paneId, run, projection) =>
    set((s) => ({
      byPane: {
        ...s.byPane,
        [paneId]: applyGraphSnapshot(ensureMutable(s.byPane, paneId), run, projection),
      },
    })),
  applyToolStep: (paneId, nodeId, step) =>
    set((s) => ({
      byPane: {
        ...s.byPane,
        [paneId]: applyToolStepToState(ensureMutable(s.byPane, paneId), nodeId, step),
      },
    })),
  setSelected: (paneId, nodeIds) =>
    set((s) => {
      const cur = s.byPane[paneId];
      const nextIds = [...nodeIds];
      const prev = cur?.selectedNodeIds ?? EMPTY_PANE_GRAPH_STATE.selectedNodeIds;
      if (
        prev.length === nextIds.length &&
        prev.every((id, i) => id === nextIds[i])
      ) {
        return s;
      }
      return {
        byPane: {
          ...s.byPane,
          [paneId]: { ...(cur ?? emptyPaneGraphState()), selectedNodeIds: nextIds },
        },
      };
    }),
  resetPane: (paneId) =>
    set((s) => {
      const next = { ...s.byPane };
      delete next[paneId];
      return { byPane: next };
    }),
  getPane: (paneId) => get().byPane[paneId] ?? EMPTY_PANE_GRAPH_STATE,
}));

export async function fetchGraphRun(
  apiBase: string,
  apiToken: string,
  runId: string,
): Promise<{ run: GraphRunSnapshot; projection: GraphProjection | null }> {
  const res = await fetch(`${apiBase}/api/graph/runs/${encodeURIComponent(runId)}`, {
    headers: { "x-agx-desktop-token": apiToken },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    ok?: boolean;
    run?: GraphRunSnapshot;
    projection?: GraphProjection;
  };
  if (!body.run) throw new Error("graph run missing in response");
  return { run: body.run, projection: body.projection ?? null };
}

export async function listGraphRunsForSession(
  apiBase: string,
  apiToken: string,
  sessionId: string,
): Promise<Array<{ run_id: string; status: string; version: number }>> {
  const url = `${apiBase}/api/graph/runs?session_id=${encodeURIComponent(sessionId)}`;
  const res = await fetch(url, { headers: { "x-agx-desktop-token": apiToken } });
  if (!res.ok) return [];
  const body = (await res.json()) as { runs?: Array<{ run_id: string; status: string; version: number }> };
  return Array.isArray(body.runs) ? body.runs : [];
}

export async function postGraphIntervene(
  apiBase: string,
  apiToken: string,
  runId: string,
  body: InterveneRequest,
): Promise<{ ok: boolean; version: number; warnings: string[]; status?: number; error?: string }> {
  const res = await fetch(`${apiBase}/api/graph/runs/${encodeURIComponent(runId)}/intervene`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agx-desktop-token": apiToken,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    version?: number;
    warnings?: string[];
    detail?: unknown;
  };
  if (res.status === 409) {
    return { ok: false, version: Number(json.version) || 0, warnings: [], status: 409, error: "version_conflict" };
  }
  if (!res.ok) {
    const detail =
      typeof json.detail === "string"
        ? json.detail
        : json.detail
          ? JSON.stringify(json.detail)
          : `HTTP ${res.status}`;
    return { ok: false, version: 0, warnings: [], status: res.status, error: detail };
  }
  return {
    ok: true,
    version: Number(json.version) || body.version + 1,
    warnings: Array.isArray(json.warnings) ? json.warnings : [],
  };
}
