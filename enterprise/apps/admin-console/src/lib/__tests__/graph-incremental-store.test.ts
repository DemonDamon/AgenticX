import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAMPLE_SOURCES,
  getAffectedForSource,
  getFingerprints,
  getGraphStats,
  getSyncRun,
  listSources,
  listSourcesWithStatus,
  listSyncRuns,
  reseedSamples,
  runMockSync,
} from "../graph-incremental-store";
import { getNeighborhood, seedBrandAGraph } from "../graph-store";

const ORIGINAL_DIR = process.env.AGX_GRAPH_INCREMENTAL_ADMIN_STORE_DIR;
let tempDir: string;

function restoreEnv() {
  if (ORIGINAL_DIR === undefined) delete process.env.AGX_GRAPH_INCREMENTAL_ADMIN_STORE_DIR;
  else process.env.AGX_GRAPH_INCREMENTAL_ADMIN_STORE_DIR = ORIGINAL_DIR;
}

const ORIGINAL_GS_DIR = process.env.AGX_GRAPH_STORE_ADMIN_DIR;
const ORIGINAL_GS_BACKEND = process.env.AGX_GRAPH_STORE_BACKEND;
const ORIGINAL_NEO = process.env.NEO4J_URI;
let graphDir: string;

describe("graph-incremental-store", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "agx-gi-"));
    graphDir = await mkdtemp(path.join(tmpdir(), "agx-gs-"));
    process.env.AGX_GRAPH_INCREMENTAL_ADMIN_STORE_DIR = tempDir;
    process.env.AGX_GRAPH_STORE_ADMIN_DIR = graphDir;
    process.env.AGX_GRAPH_STORE_BACKEND = "file";
    delete process.env.NEO4J_URI;
  });

  afterEach(async () => {
    restoreEnv();
    if (ORIGINAL_GS_DIR === undefined) delete process.env.AGX_GRAPH_STORE_ADMIN_DIR;
    else process.env.AGX_GRAPH_STORE_ADMIN_DIR = ORIGINAL_GS_DIR;
    if (ORIGINAL_GS_BACKEND === undefined) delete process.env.AGX_GRAPH_STORE_BACKEND;
    else process.env.AGX_GRAPH_STORE_BACKEND = ORIGINAL_GS_BACKEND;
    if (ORIGINAL_NEO === undefined) delete process.env.NEO4J_URI;
    else process.env.NEO4J_URI = ORIGINAL_NEO;
    await rm(tempDir, { recursive: true, force: true });
    await rm(graphDir, { recursive: true, force: true });
  });

  it("seeds cooling-loop sources and two sync runs (full + incremental)", async () => {
    const sources = await listSources();
    expect(sources.map((s) => s.id).sort()).toEqual(
      [...SAMPLE_SOURCES.map((s) => s.id)].sort(),
    );
    const blob = JSON.stringify(sources).toLowerCase();
    expect(blob).toContain("cooling-loop");
    expect(blob).not.toContain("proposal");

    const runs = await listSyncRuns();
    expect(runs.length).toBe(2);
    const full = runs.find((r) => r.run_id === "sync-full-001");
    const incr = runs.find((r) => r.run_id === "sync-incr-002");
    expect(full?.added.length).toBe(SAMPLE_SOURCES.length);
    expect(full?.extracted_source_ids.length).toBe(SAMPLE_SOURCES.length);
    expect(incr?.unchanged.length).toBe(SAMPLE_SOURCES.length);
    expect(incr?.extracted_source_ids).toEqual([]);
  });

  it("lists sources with last sync status from newest run", async () => {
    const rows = await listSourcesWithStatus();
    expect(rows.length).toBe(SAMPLE_SOURCES.length);
    for (const row of rows) {
      expect(row.last_sync_status).toBe("unchanged");
      expect(row.last_run_id).toBe("sync-incr-002");
      expect(row.object_ids.length).toBeGreaterThan(0);
      expect(row.fingerprint).toBeTruthy();
    }
  });

  it("resolves affected object ids for a source", async () => {
    const affected = await getAffectedForSource("src-ledger-pump-01");
    expect(affected.object_ids).toEqual(["device-pump-01"]);
  });

  it("mock sync with no content change skips extract (unchanged)", async () => {
    const before = await listSyncRuns();
    const report = await runMockSync({ actor: "tester" });
    expect(report.unchanged.length).toBe(SAMPLE_SOURCES.length);
    expect(report.extracted_source_ids).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
    const after = await listSyncRuns();
    expect(after.length).toBe(before.length + 1);
    expect(await getSyncRun(report.run_id)).not.toBeNull();
  });

  it("mock sync force-changed extracts only that source", async () => {
    const report = await runMockSync({
      actor: "tester",
      forceChangedIds: ["src-ops-note-valve"],
    });
    expect(report.changed).toEqual(["src-ops-note-valve"]);
    expect(report.extracted_source_ids).toEqual(["src-ops-note-valve"]);
    expect(report.unchanged).toContain("src-ledger-pump-01");
    expect(report.touched_object_ids).toContain("device-valve-01");
    const fps = await getFingerprints();
    expect(fps["src-ops-note-valve"]).toBeTruthy();
  });

  it("reseed restores cooling-loop demo payload", async () => {
    await runMockSync({ forceChangedIds: ["src-site-cooling-1"] });
    const seeded = await reseedSamples();
    expect(seeded.sources.length).toBe(SAMPLE_SOURCES.length);
    expect(seeded.runs.map((r) => r.run_id).sort()).toEqual([
      "sync-full-001",
      "sync-incr-002",
    ]);
    expect(seeded.graph_stats.store_backend).toBeTruthy();
    expect(["file", "memory", "neo4j"]).toContain(String(seeded.graph_stats.store_backend));
    expect(seeded.runs[0]?.graph_stats?.store_backend).toBe(seeded.graph_stats.store_backend);
  });

  it("mock sync reports GraphStore store_backend (not JSON-as-SoT)", async () => {
    const report = await runMockSync({ actor: "tester" });
    expect(report.graph_stats.store_backend).toBeTruthy();
    expect(["file", "memory", "neo4j"]).toContain(String(report.graph_stats.store_backend));
  });

  it("getGraphStats returns live GraphStore store_backend", async () => {
    await seedBrandAGraph();
    const stats = await getGraphStats();
    expect(stats?.store_backend).toBe("file");
    expect(stats?.entity_count).toBeGreaterThan(0);
  });

  it("force-changed sync publishes into GraphStore (explorer-visible attrs)", async () => {
    await seedBrandAGraph();
    const report = await runMockSync({
      actor: "tester",
      forceChangedIds: ["src-ops-note-valve"],
    });
    expect(report.published_object_ids).toContain("device-valve-01");
    expect(report.graph_stats.published_into_store).toEqual(
      expect.arrayContaining(["device-valve-01"]),
    );
    const nb = await getNeighborhood("device-valve-01", { depth: 0 });
    const node = nb.nodes.find((n) => n.id === "device-valve-01");
    expect(node?.attributes?.last_sync_run_id).toBe(report.run_id);
    expect(node?.attributes?.last_synced_at).toBeTruthy();
    expect(String(node?.attributes?.last_sync_actor)).toBe("tester");
  });
});
