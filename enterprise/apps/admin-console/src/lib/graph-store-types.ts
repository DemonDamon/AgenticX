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

/** Synthetic Brand-A seed only — no real customer identifiers. */
export const BRAND_A_GRAPH_NODES: GraphNode[] = [
  {
    id: "brand-a-entity-pump-01",
    name: "Pump 01",
    entity_type: "unknown",
    description: "Brand-A sample pump",
    attributes: { site: "plant-a", kind: "pump", brand: "brand-a" },
  },
  {
    id: "brand-a-site-plant-a",
    name: "Plant A",
    entity_type: "unknown",
    description: "Brand-A sample plant site",
    attributes: { kind: "site", brand: "brand-a" },
  },
  {
    id: "brand-a-entity-valve-01",
    name: "Valve 01",
    entity_type: "unknown",
    description: "Brand-A sample valve",
    attributes: { site: "plant-a", kind: "valve", brand: "brand-a" },
  },
];

export const BRAND_A_GRAPH_EDGES: GraphEdge[] = [
  {
    id: "brand-a-rel-pump-at-plant",
    source_entity_id: "brand-a-entity-pump-01",
    target_entity_id: "brand-a-site-plant-a",
    relation_type: "related_to",
    description: "Pump located at Plant A",
    attributes: { brand: "brand-a" },
  },
  {
    id: "brand-a-rel-valve-at-plant",
    source_entity_id: "brand-a-entity-valve-01",
    target_entity_id: "brand-a-site-plant-a",
    relation_type: "related_to",
    description: "Valve located at Plant A",
    attributes: { brand: "brand-a" },
  },
];
