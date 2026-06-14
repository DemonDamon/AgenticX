export type GraphNodeKind = "entity" | "episode" | "community";

export type GraphNodeDTO = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  summary?: string;
  validAt?: string | null;
  invalidAt?: string | null;
};

export type GraphEdgeDTO = {
  id: string;
  source: string;
  target: string;
  label: string;
  status: "active" | "invalidated";
  validAt?: string | null;
  invalidAt?: string | null;
};

export type GraphViewDTO = {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  meta: {
    groupId: string;
    generatedAt: string;
    truncated: boolean;
    nodeCount?: number;
    edgeCount?: number;
  };
};

export type GraphEpisodeDTO = {
  id: string;
  name: string;
  referenceTime?: string | null;
  sourceDescription?: string;
  preview?: string;
};

export type MemoryGraphScope = "avatar" | "meta" | "group";

export type MemoryGraphStatus = {
  ok?: boolean;
  enabled?: boolean;
  graphiti_installed?: boolean;
  python_executable?: string;
  install_hint?: string | null;
  auto_install_allowed?: boolean;
  pending_jobs?: number;
  completed_jobs?: number;
  job_progress?: number;
  job_stage?: string | null;
  job_active?: boolean;
  last_error?: string | null;
  last_error_at?: string | null;
  last_success_at?: string | null;
  node_count?: number;
  edge_count?: number;
  config?: {
    enabled?: boolean;
    default_scope?: MemoryGraphScope;
  };
  models?: {
    llm_provider?: string;
    llm_model?: string;
    embedder_provider?: string;
    embedder_model?: string;
    default_provider?: string;
  } | null;
};

export type WorkspaceMemoryEntry = {
  index: number;
  text: string;
  line: number;
  children?: string[];
};
export type WorkspaceMemorySection = { section: string; entries: WorkspaceMemoryEntry[] };
export type WorkspaceMemoryDoc = { sections: WorkspaceMemorySection[]; path: string };
