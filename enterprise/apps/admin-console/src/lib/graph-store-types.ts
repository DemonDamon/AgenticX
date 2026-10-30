/** GraphStore-shaped DTOs for admin graph explorer (mirrors Python GraphStore query helpers). */

export type GraphBackendName = "memory" | "file" | "neo4j";

export type GraphNode = {
  id: string;
  name: string;
  entity_type: string;
  description?: string | null;
  attributes: Record<string, unknown>;
  source_chunks?: string[];
  confidence?: number;
  created_at?: string;
  updated_at?: string;
};

export type GraphEdge = {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  description?: string | null;
  attributes: Record<string, unknown>;
  confidence?: number;
  created_at?: string;
};

export type GraphSubgraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: Record<string, unknown>;
  backend?: GraphBackendName | string;
};

export type GraphNeighborhood = {
  center_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  backend?: GraphBackendName | string;
};

export type GraphStoreStats = {
  backend: GraphBackendName | string;
  entity_count: number;
  relationship_count: number;
  [key: string]: unknown;
};

/** 示例化工厂·冷却回路 synthetic seed — desensitized demo. */
export const SAMPLE_GRAPH_NODES: GraphNode[] = [
  {
    id: "device-pump-01",
    name: "1号循环泵",
    entity_type: "unknown",
    description: "示例化工厂冷却回路 · 1号循环泵",
    attributes: { site: "一车间冷却区", kind: "pump", scenario: "cooling-loop" },
  },
  {
    id: "site-cooling-zone-1",
    name: "一车间冷却区",
    entity_type: "unknown",
    description: "示例化工厂 · 一车间冷却区",
    attributes: { kind: "site", scenario: "cooling-loop" },
  },
  {
    id: "device-valve-01",
    name: "回路切断阀",
    entity_type: "unknown",
    description: "示例化工厂冷却回路 · 切断阀",
    attributes: { site: "一车间冷却区", kind: "valve", scenario: "cooling-loop" },
  },
];

/** @deprecated use SAMPLE_GRAPH_NODES */
export const BRAND_A_GRAPH_NODES = SAMPLE_GRAPH_NODES;

export const SAMPLE_GRAPH_EDGES: GraphEdge[] = [
  {
    id: "rel-pump01-in-zone1",
    source_entity_id: "device-pump-01",
    target_entity_id: "site-cooling-zone-1",
    relation_type: "related_to",
    description: "1号循环泵位于一车间冷却区",
    attributes: { scenario: "cooling-loop" },
  },
  {
    id: "rel-valve01-in-zone1",
    source_entity_id: "device-valve-01",
    target_entity_id: "site-cooling-zone-1",
    relation_type: "related_to",
    description: "回路切断阀位于一车间冷却区",
    attributes: { scenario: "cooling-loop" },
  },
];

/** @deprecated use SAMPLE_GRAPH_EDGES */
export const BRAND_A_GRAPH_EDGES = SAMPLE_GRAPH_EDGES;
