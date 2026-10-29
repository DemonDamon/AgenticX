import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRAND_A_GRAPH_NODES,
  __resetMemoryGraphStoreForTests,
  getGraphStats,
  getNeighborhood,
  getSubgraph,
  seedBrandAGraph,
} from "../graph-store";

const ORIGINAL_BACKEND = process.env.AGX_GRAPH_STORE_BACKEND;
const ORIGINAL_DIR = process.env.AGX_GRAPH_STORE_ADMIN_DIR;
const ORIGINAL_NEO = process.env.NEO4J_URI;
let tempDir: string;

function restoreEnv() {
  if (ORIGINAL_BACKEND === undefined) delete process.env.AGX_GRAPH_STORE_BACKEND;
  else process.env.AGX_GRAPH_STORE_BACKEND = ORIGINAL_BACKEND;
  if (ORIGINAL_DIR === undefined) delete process.env.AGX_GRAPH_STORE_ADMIN_DIR;
  else process.env.AGX_GRAPH_STORE_ADMIN_DIR = ORIGINAL_DIR;
  if (ORIGINAL_NEO === undefined) delete process.env.NEO4J_URI;
  else process.env.NEO4J_URI = ORIGINAL_NEO;
}

describe("graph-store (admin GraphStore layer)", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agx-gs-"));
    process.env.AGX_GRAPH_STORE_ADMIN_DIR = tempDir;
    process.env.AGX_GRAPH_STORE_BACKEND = "file";
    delete process.env.NEO4J_URI;
    __resetMemoryGraphStoreForTests();
  });

  afterEach(async () => {
    restoreEnv();
    __resetMemoryGraphStoreForTests();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("seeds Brand-A into file GraphStore and reports backend", async () => {
    const seeded = await seedBrandAGraph();
    expect(seeded.backend).toBe("file");
    expect(seeded.stats.entity_count).toBe(BRAND_A_GRAPH_NODES.length);
    expect(seeded.stats.relationship_count).toBe(2);
    const stats = await getGraphStats();
    expect(stats.backend).toBe("file");
    expect(stats.store_backend).toBe("file");
    const blob = JSON.stringify(await getSubgraph());
    expect(blob.toLowerCase()).toContain("brand-a");
    expect(blob.toLowerCase()).not.toContain("proposal");
  });

  it("returns subgraph nodes/edges from GraphStore", async () => {
    await seedBrandAGraph();
    const sub = await getSubgraph();
    expect(sub.nodes.length).toBe(3);
    expect(sub.edges.length).toBe(2);
    expect(sub.backend).toBe("file");
  });

  it("neighborhood depth-1 around pump excludes valve", async () => {
    await seedBrandAGraph();
    const nb = await getNeighborhood("brand-a-entity-pump-01", { depth: 1 });
    const ids = nb.nodes.map((n) => n.id);
    expect(ids).toContain("brand-a-entity-pump-01");
    expect(ids).toContain("brand-a-site-plant-a");
    expect(ids).not.toContain("brand-a-entity-valve-01");
  });

  it("memory backend works for in-process tests", async () => {
    process.env.AGX_GRAPH_STORE_BACKEND = "memory";
    __resetMemoryGraphStoreForTests();
    const seeded = await seedBrandAGraph();
    expect(seeded.backend).toBe("memory");
    const sub = await getSubgraph();
    expect(sub.nodes.length).toBe(3);
  });
});
