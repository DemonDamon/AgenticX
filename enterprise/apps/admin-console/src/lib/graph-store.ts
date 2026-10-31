/**
 * Admin GraphStore read/seed layer.
 * Local demo: memory or file. Production path: NEO4J_URI → Python GraphStore bridge.
 * File/JSON is a GraphStore backend for fixtures — not claimed as production SoT.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  BRAND_A_GRAPH_EDGES,
  BRAND_A_GRAPH_NODES,
  type GraphBackendName,
  type GraphEdge,
  type GraphNeighborhood,
  type GraphNode,
  type GraphStoreStats,
  type GraphSubgraph,
} from "./graph-store-types";

export type {
  GraphBackendName,
  GraphEdge,
  GraphNeighborhood,
  GraphNode,
  GraphStoreStats,
  GraphSubgraph,
} from "./graph-store-types";
export { BRAND_A_GRAPH_EDGES, BRAND_A_GRAPH_NODES } from "./graph-store-types";

type StoreBlob = { nodes: GraphNode[]; edges: GraphEdge[] };

function storeDir(): string {
  const env = process.env.AGX_GRAPH_STORE_ADMIN_DIR?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "../../.runtime/admin/graph-store");
}

function fileStorePath(): string {
  const env = process.env.AGX_GRAPH_STORE_FILE_PATH?.trim();
  if (env) return env;
  return path.join(storeDir(), "graph.json");
}

function resolveBackend(): GraphBackendName {
  const raw = (process.env.AGX_GRAPH_STORE_BACKEND || "").trim().toLowerCase();
  if (raw === "neo4j" || raw === "memory" || raw === "file") return raw;
  if (process.env.NEO4J_URI?.trim()) return "neo4j";
  // Durable local demo default — survives admin restarts without Neo4j.
  return "file";
}

function cloneNode(n: GraphNode): GraphNode {
  return {
    ...n,
    attributes: { ...(n.attributes || {}) },
    source_chunks: n.source_chunks ? [...n.source_chunks] : undefined,
  };
}

function cloneEdge(e: GraphEdge): GraphEdge {
  return { ...e, attributes: { ...(e.attributes || {}) } };
}

class MemoryGraphStore {
  backendName: GraphBackendName = "memory";
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

  upsertNode(node: GraphNode): void {
    this.nodes.set(node.id, cloneNode(node));
  }
  upsertEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, cloneEdge(edge));
  }
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
  }
  stats(): GraphStoreStats {
    return {
      backend: this.backendName,
      entity_count: this.nodes.size,
      relationship_count: this.edges.size,
    };
  }
  listNodes(limit = 500): GraphNode[] {
    return [...this.nodes.keys()]
      .sort()
      .slice(0, Math.max(1, limit))
      .map((id) => cloneNode(this.nodes.get(id)!));
  }
  listEdges(limit = 1000): GraphEdge[] {
    return [...this.edges.keys()]
      .sort()
      .slice(0, Math.max(1, limit))
      .map((id) => cloneEdge(this.edges.get(id)!));
  }
  getNode(id: string): GraphNode | null {
    const n = this.nodes.get(id);
    return n ? cloneNode(n) : null;
  }
  neighborhood(entityId: string, depth = 1, limit = 200): GraphNeighborhood {
    depth = Math.max(0, depth);
    limit = Math.max(1, limit);
    if (!this.nodes.has(entityId)) {
      return { center_id: entityId, nodes: [], edges: [], backend: this.backendName };
    }
    let frontier = new Set<string>([entityId]);
    const seenNodes = new Set<string>([entityId]);
    const seenEdges = new Set<string>();
    for (let d = 0; d < depth; d++) {
      if (seenNodes.size >= limit) break;
      const next = new Set<string>();
      for (const [rid, rel] of this.edges) {
        if (seenEdges.has(rid)) continue;
        if (frontier.has(rel.source_entity_id) || frontier.has(rel.target_entity_id)) {
          seenEdges.add(rid);
          for (const nid of [rel.source_entity_id, rel.target_entity_id]) {
            if (this.nodes.has(nid) && !seenNodes.has(nid) && seenNodes.size < limit) {
              seenNodes.add(nid);
              next.add(nid);
            }
          }
        }
      }
      frontier = next;
      if (frontier.size === 0) break;
    }
    const nodes = [...seenNodes]
      .filter((id) => this.nodes.has(id))
      .sort()
      .map((id) => cloneNode(this.nodes.get(id)!));
    const edges = [...seenEdges]
      .filter((id) => {
        const e = this.edges.get(id);
        return e && seenNodes.has(e.source_entity_id) && seenNodes.has(e.target_entity_id);
      })
      .sort()
      .map((id) => cloneEdge(this.edges.get(id)!));
    return { center_id: entityId, nodes, edges, backend: this.backendName };
  }
  subgraph(entityIds?: string[], limitNodes = 200): GraphSubgraph {
    limitNodes = Math.max(1, limitNodes);
    let chosen: string[];
    if (!entityIds || entityIds.length === 0) {
      chosen = [...this.nodes.keys()].sort().slice(0, limitNodes);
    } else {
      const wanted = new Set(entityIds);
      chosen = [...this.nodes.keys()].filter((id) => wanted.has(id)).sort().slice(0, limitNodes);
    }
    const nodeSet = new Set(chosen);
    const nodes = chosen.map((id) => cloneNode(this.nodes.get(id)!));
    const edges = [...this.edges.keys()]
      .sort()
      .map((id) => this.edges.get(id)!)
      .filter((e) => nodeSet.has(e.source_entity_id) && nodeSet.has(e.target_entity_id))
      .map(cloneEdge);
    return {
      nodes,
      edges,
      backend: this.backendName,
      stats: {
        backend: this.backendName,
        entity_count: nodes.length,
        relationship_count: edges.length,
        store_entity_count: this.nodes.size,
        store_relationship_count: this.edges.size,
      },
    };
  }
  toBlob(): StoreBlob {
    return { nodes: this.listNodes(10_000), edges: this.listEdges(20_000) };
  }
  loadBlob(blob: StoreBlob): void {
    this.clear();
    for (const n of blob.nodes || []) this.upsertNode(n);
    for (const e of blob.edges || []) this.upsertEdge(e);
  }
}

class FileGraphStore extends MemoryGraphStore {
  backendName: GraphBackendName = "file";
  constructor(private readonly filePath: string) {
    super();
  }
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const blob = JSON.parse(raw) as StoreBlob;
      this.loadBlob(blob);
    } catch {
      // empty until seed
    }
  }
  async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.toBlob(), null, 2)}\n`, "utf-8");
  }
}

/** Process-local memory singleton (tests / AGX_GRAPH_STORE_BACKEND=memory). */
const globalMemory = new MemoryGraphStore();

function resolvePythonRepoRoot(): string {
  const repoHint = process.env.AGX_REPO_ROOT?.trim();
  if (repoHint) return repoHint;
  // Next.js cwd is apps/admin-console → repo root is three levels up.
  return path.resolve(process.cwd(), "../../..");
}

async function pythonBridge(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  const python = process.env.AGX_PYTHON || process.env.PYTHON || "python3";
  const cwd = resolvePythonRepoRoot();
  const env = {
    ...process.env,
    PYTHONPATH: [cwd, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
  return await new Promise((resolve, reject) => {
    const child = spawn(python, ["-m", "agenticx.knowledge.graphers.store.query_cli"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => {
      stdout += String(b);
    });
    child.stderr.on("data", (b) => {
      stderr += String(b);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `query_cli exit ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    child.stdin.write(JSON.stringify(req));
    child.stdin.end();
  });
}

async function getLocalStore(): Promise<MemoryGraphStore> {
  const backend = resolveBackend();
  if (backend === "memory") {
    if (globalMemory.stats().entity_count === 0) {
      // lazy empty — callers seed
    }
    return globalMemory;
  }
  const file = new FileGraphStore(fileStorePath());
  await file.load();
  return file;
}

export function getGraphStoreBackendLabel(): GraphBackendName {
  return resolveBackend();
}

export async function getGraphStats(): Promise<GraphStoreStats> {
  const backend = resolveBackend();
  if (backend === "neo4j") {
    const res = await pythonBridge({ op: "stats", backend: "neo4j" });
    if (!res.ok) throw new Error(String(res.error || "neo4j stats failed"));
    const data = (res.data || {}) as GraphStoreStats;
    return { ...data, backend: "neo4j", store_backend: "neo4j" };
  }
  const store = await getLocalStore();
  const s = store.stats();
  return { ...s, store_backend: s.backend };
}

export async function getSubgraph(opts?: {
  entityIds?: string[];
  limitNodes?: number;
}): Promise<GraphSubgraph> {
  const backend = resolveBackend();
  if (backend === "neo4j") {
    const res = await pythonBridge({
      op: "subgraph",
      backend: "neo4j",
      entity_ids: opts?.entityIds,
      limit_nodes: opts?.limitNodes ?? 200,
    });
    if (!res.ok) throw new Error(String(res.error || "neo4j subgraph failed"));
    const data = res.data as GraphSubgraph;
    return { ...data, backend: "neo4j" };
  }
  const store = await getLocalStore();
  if (store.stats().entity_count === 0) {
    await seedBrandAGraph();
    return getSubgraph(opts);
  }
  return store.subgraph(opts?.entityIds, opts?.limitNodes ?? 200);
}

export async function getNeighborhood(
  entityId: string,
  opts?: { depth?: number; limit?: number },
): Promise<GraphNeighborhood> {
  const backend = resolveBackend();
  if (backend === "neo4j") {
    const res = await pythonBridge({
      op: "neighborhood",
      backend: "neo4j",
      entity_id: entityId,
      depth: opts?.depth ?? 1,
      limit: opts?.limit ?? 200,
    });
    if (!res.ok) throw new Error(String(res.error || "neo4j neighborhood failed"));
    const data = res.data as GraphNeighborhood;
    return { ...data, backend: "neo4j" };
  }
  const store = await getLocalStore();
  if (store.stats().entity_count === 0) {
    await seedBrandAGraph();
    return getNeighborhood(entityId, opts);
  }
  return store.neighborhood(entityId, opts?.depth ?? 1, opts?.limit ?? 200);
}

export async function getNode(entityId: string): Promise<GraphNode | null> {
  const sub = await getNeighborhood(entityId, { depth: 0, limit: 1 });
  return sub.nodes.find((n) => n.id === entityId) ?? null;
}

export async function seedBrandAGraph(): Promise<{
  backend: string;
  stats: GraphStoreStats;
}> {
  const backend = resolveBackend();
  if (backend === "neo4j") {
    const res = await pythonBridge({ op: "seed_brand_a", backend: "neo4j" });
    if (!res.ok) throw new Error(String(res.error || "neo4j seed failed"));
    const data = res.data as { stats: GraphStoreStats; backend: string };
    return { backend: data.backend || "neo4j", stats: data.stats };
  }
  if (backend === "memory") {
    globalMemory.clear();
    for (const n of BRAND_A_GRAPH_NODES) globalMemory.upsertNode(n);
    for (const e of BRAND_A_GRAPH_EDGES) globalMemory.upsertEdge(e);
    const stats = globalMemory.stats();
    return { backend: stats.backend, stats };
  }
  const file = new FileGraphStore(fileStorePath());
  file.clear();
  for (const n of BRAND_A_GRAPH_NODES) file.upsertNode(n);
  for (const e of BRAND_A_GRAPH_EDGES) file.upsertEdge(e);
  await file.persist();
  const stats = file.stats();
  return { backend: stats.backend, stats };
}


export type PublishTouchMeta = {
  synced_at: string;
  run_id: string;
  actor?: string;
  source_ids?: string[];
};

/**
 * Incremental publish into GraphStore SoT: stamp last_synced_* attrs on touched
 * entities so explorer reflects sync (not JSON sync metadata alone).
 */
export async function publishTouchedObjects(
  objectIds: string[],
  meta: PublishTouchMeta,
): Promise<{ backend: string; updated_object_ids: string[]; stats: GraphStoreStats }> {
  const ids = [...new Set(objectIds.map(String).filter(Boolean))].sort();
  if (ids.length === 0) {
    const stats = await getGraphStats();
    return { backend: String(stats.backend), updated_object_ids: [], stats };
  }
  const backend = resolveBackend();
  if (backend === "neo4j") {
    const res = await pythonBridge({
      op: "publish_touch",
      backend: "neo4j",
      object_ids: ids,
      meta: {
        synced_at: meta.synced_at,
        run_id: meta.run_id,
        actor: meta.actor || "",
        source_ids: meta.source_ids || [],
      },
    });
    if (!res.ok) throw new Error(String(res.error || "neo4j publish_touch failed"));
    const data = res.data as {
      backend?: string;
      updated_object_ids?: string[];
      stats: GraphStoreStats;
    };
    return {
      backend: data.backend || "neo4j",
      updated_object_ids: data.updated_object_ids || ids,
      stats: { ...data.stats, backend: "neo4j", store_backend: "neo4j" },
    };
  }

  // Ensure sample baseline exists before stamping (local demo backends).
  const store = await getLocalStore();
  if (store.stats().entity_count === 0) {
    await seedBrandAGraph();
  }
  const live = await getLocalStore();
  const updated: string[] = [];
  for (const oid of ids) {
    const existing = live.getNode(oid);
    const base = existing
      ? cloneNode(existing)
      : ({
          id: oid,
          name: oid,
          entity_type: "unknown",
          description: null,
          attributes: { scenario: "cooling-loop" },
        } satisfies GraphNode);
    base.attributes = {
      ...(base.attributes || {}),
      last_synced_at: meta.synced_at,
      last_sync_run_id: meta.run_id,
      ...(meta.actor ? { last_sync_actor: meta.actor } : {}),
      ...(meta.source_ids?.length
        ? { last_sync_source_ids: [...meta.source_ids] }
        : {}),
    };
    live.upsertNode(base);
    updated.push(oid);
  }
  if (backend === "file") {
    const maybe = live as MemoryGraphStore & { persist?: () => Promise<void> };
    if (typeof maybe.persist === "function") await maybe.persist();
  }
  const stats = live.stats();
  return {
    backend: stats.backend,
    updated_object_ids: updated,
    stats: { ...stats, store_backend: stats.backend },
  };
}

/** Reset memory singleton between vitest cases. */
export function __resetMemoryGraphStoreForTests(): void {
  globalMemory.clear();
}
