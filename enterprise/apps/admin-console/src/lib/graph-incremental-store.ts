import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SAMPLE_GRAPH_STATS,
  SAMPLE_SOURCE_INDEX,
  SAMPLE_SOURCES,
  type ChangeSetRow,
  type GraphStatsSnapshot,
  type SourceDocumentRow,
  type SourceIndexLinks,
  type SourceWithStatus,
  type SyncReportRow,
} from "./graph-incremental-types";
import {
  getGraphStats as getStoreStats,
  publishTouchedObjects,
  seedBrandAGraph,
} from "./graph-store";

export type {
  ChangeSetRow,
  GraphStatsSnapshot,
  SourceDocumentRow,
  SourceIndexLinks,
  SourceWithStatus,
  SyncReportRow,
} from "./graph-incremental-types";
export {
  SAMPLE_GRAPH_STATS,
  SAMPLE_SOURCE_INDEX,
  SAMPLE_SOURCES,
} from "./graph-incremental-types";

type SourcesFile = { sources: SourceDocumentRow[] };
type FingerprintsFile = { fingerprints: Record<string, string> };
type SyncRunsFile = { runs: SyncReportRow[] };
type SourceIndexFile = { links: SourceIndexLinks };

function storeDir(): string {
  const env = process.env.AGX_GRAPH_INCREMENTAL_ADMIN_STORE_DIR?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "../../.runtime/admin/graph-incremental");
}

function sourcesPath(): string {
  return path.join(storeDir(), "sources.json");
}
function fingerprintsPath(): string {
  return path.join(storeDir(), "fingerprints.json");
}
function syncRunsPath(): string {
  return path.join(storeDir(), "sync_runs.json");
}
function sourceIndexPath(): string {
  return path.join(storeDir(), "source_index.json");
}
function graphStatsPath(): string {
  return path.join(storeDir(), "graph_stats.json");
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function contentHash(text: string): string {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function cloneSource(row: SourceDocumentRow): SourceDocumentRow {
  return {
    ...row,
    content_hash: row.content_hash || contentHash(row.content),
    meta: { ...(row.meta || {}) },
  };
}

function cloneReport(row: SyncReportRow): SyncReportRow {
  return {
    run_id: row.run_id,
    added: [...(row.added || [])],
    changed: [...(row.changed || [])],
    removed: [...(row.removed || [])],
    unchanged: [...(row.unchanged || [])],
    extracted_source_ids: [...(row.extracted_source_ids || [])],
    touched_object_ids: [...(row.touched_object_ids || [])],
    published_object_ids: [...(row.published_object_ids || [])],
    retired_object_ids: [...(row.retired_object_ids || [])],
    graph_stats: { ...(row.graph_stats || {}) },
    at: row.at,
  };
}

function buildSeedSources(): SourceDocumentRow[] {
  return SAMPLE_SOURCES.map((s) =>
    cloneSource({
      ...s,
      content_hash: contentHash(s.content),
    }),
  );
}

function buildSeedFingerprints(sources: SourceDocumentRow[]): Record<string, string> {
  const fps: Record<string, string> = {};
  for (const s of sources) fps[s.id] = s.content_hash;
  return fps;
}

function buildSeedRuns(sources: SourceDocumentRow[]): SyncReportRow[] {
  const ids = sources.map((s) => s.id);
  const objectIds = Object.values(SAMPLE_SOURCE_INDEX).flat();
  const full: SyncReportRow = {
    run_id: "brand-a-sync-full-001",
    added: [...ids],
    changed: [],
    removed: [],
    unchanged: [],
    extracted_source_ids: [...ids],
    touched_object_ids: [...objectIds],
    published_object_ids: [...objectIds],
    retired_object_ids: [],
    graph_stats: {
      entity_count: SAMPLE_GRAPH_STATS.entity_count,
      relation_count: SAMPLE_GRAPH_STATS.relation_count,
    },
    at: "2026-10-29T02:05:00Z",
  };
  const incremental: SyncReportRow = {
    run_id: "brand-a-sync-incr-002",
    added: [],
    changed: [],
    removed: [],
    unchanged: [...ids],
    extracted_source_ids: [],
    touched_object_ids: [],
    published_object_ids: [],
    retired_object_ids: [],
    graph_stats: {
      entity_count: SAMPLE_GRAPH_STATS.entity_count,
      relation_count: SAMPLE_GRAPH_STATS.relation_count,
      skipped_unchanged: ids.length,
    },
    at: "2026-10-29T03:05:00Z",
  };
  return [full, incremental];
}

export async function reseedSamples(): Promise<{
  sources: SourceDocumentRow[];
  runs: SyncReportRow[];
  links: SourceIndexLinks;
  graph_stats: GraphStatsSnapshot;
}> {
  const sources = buildSeedSources();
  const fingerprints = buildSeedFingerprints(sources);
  const runs = buildSeedRuns(sources);
  const links: SourceIndexLinks = {};
  for (const [k, v] of Object.entries(SAMPLE_SOURCE_INDEX)) {
    links[k] = [...v];
  }
  // Publish SoT: Brand-A entities/edges live in GraphStore (not JSON alone).
  const seeded = await seedBrandAGraph();
  const storeStats = seeded.stats;
  const graph_stats: GraphStatsSnapshot = {
    entity_count: Number(storeStats.entity_count) || SAMPLE_GRAPH_STATS.entity_count,
    relation_count: Number(storeStats.relationship_count) || SAMPLE_GRAPH_STATS.relation_count,
    updated_at: nowIso(),
    store_backend: String(storeStats.backend || seeded.backend),
  };
  const runsWithBackend = runs.map((r) => ({
    ...r,
    graph_stats: {
      ...r.graph_stats,
      store_backend: graph_stats.store_backend,
      entity_count: graph_stats.entity_count,
      relation_count: graph_stats.relation_count,
    },
  }));
  await writeJsonFile(sourcesPath(), { sources });
  await writeJsonFile(fingerprintsPath(), { fingerprints });
  await writeJsonFile(syncRunsPath(), { runs: runsWithBackend });
  await writeJsonFile(sourceIndexPath(), { links });
  await writeJsonFile(graphStatsPath(), graph_stats);
  return { sources, runs: runsWithBackend, links, graph_stats };
}

async function ensureSeeded(): Promise<void> {
  try {
    await readFile(sourcesPath(), "utf-8");
  } catch {
    await reseedSamples();
  }
}

export async function listSources(): Promise<SourceDocumentRow[]> {
  await ensureSeeded();
  const data = await readJsonFile<SourcesFile>(sourcesPath(), { sources: [] });
  return (data.sources ?? []).map(cloneSource).sort((a, b) => a.id.localeCompare(b.id));
}

export async function getFingerprints(): Promise<Record<string, string>> {
  await ensureSeeded();
  const data = await readJsonFile<FingerprintsFile>(fingerprintsPath(), { fingerprints: {} });
  return { ...(data.fingerprints || {}) };
}

export async function listSyncRuns(): Promise<SyncReportRow[]> {
  await ensureSeeded();
  const data = await readJsonFile<SyncRunsFile>(syncRunsPath(), { runs: [] });
  return (data.runs ?? []).map(cloneReport).sort((a, b) => b.at.localeCompare(a.at));
}

export async function getSyncRun(runId: string): Promise<SyncReportRow | null> {
  const runs = await listSyncRuns();
  return runs.find((r) => r.run_id === runId) ?? null;
}

export async function getSourceIndex(): Promise<SourceIndexLinks> {
  await ensureSeeded();
  const data = await readJsonFile<SourceIndexFile>(sourceIndexPath(), { links: {} });
  const out: SourceIndexLinks = {};
  for (const [k, v] of Object.entries(data.links || {})) {
    out[k] = [...(v || [])];
  }
  return out;
}

export async function getAffectedForSource(sourceId: string): Promise<{
  source_id: string;
  object_ids: string[];
}> {
  const links = await getSourceIndex();
  return {
    source_id: sourceId,
    object_ids: [...(links[sourceId] || [])].sort(),
  };
}

export async function getGraphStats(): Promise<GraphStatsSnapshot | null> {
  await ensureSeeded();
  try {
    await readFile(graphStatsPath(), "utf-8");
    return await readJsonFile<GraphStatsSnapshot>(graphStatsPath(), {
      entity_count: 0,
      relation_count: 0,
      updated_at: nowIso(),
    });
  } catch {
    return null;
  }
}

function lastStatusForSource(
  sourceId: string,
  runs: SyncReportRow[],
): { status: SourceWithStatus["last_sync_status"]; run_id?: string } {
  for (const run of runs) {
    if (run.extracted_source_ids.includes(sourceId)) {
      return { status: "extracted", run_id: run.run_id };
    }
    if (run.added.includes(sourceId)) return { status: "added", run_id: run.run_id };
    if (run.changed.includes(sourceId)) return { status: "changed", run_id: run.run_id };
    if (run.removed.includes(sourceId)) return { status: "removed", run_id: run.run_id };
    if (run.unchanged.includes(sourceId)) return { status: "unchanged", run_id: run.run_id };
  }
  return { status: "never" };
}

export async function listSourcesWithStatus(): Promise<SourceWithStatus[]> {
  const [sources, fps, runs, links] = await Promise.all([
    listSources(),
    getFingerprints(),
    listSyncRuns(),
    getSourceIndex(),
  ]);
  return sources.map((s) => {
    const { status, run_id } = lastStatusForSource(s.id, runs);
    return {
      ...s,
      fingerprint: fps[s.id] || s.content_hash,
      object_ids: [...(links[s.id] || [])],
      last_sync_status: status,
      last_run_id: run_id,
    };
  });
}

function diffMaps(
  prior: Record<string, string>,
  current: Record<string, string>,
): ChangeSetRow {
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  const removed: string[] = [];
  for (const sid of Object.keys(current).sort()) {
    if (!(sid in prior)) added.push(sid);
    else if (prior[sid] !== current[sid]) changed.push(sid);
    else unchanged.push(sid);
  }
  for (const sid of Object.keys(prior).sort()) {
    if (!(sid in current)) removed.push(sid);
  }
  return { added, changed, removed, unchanged };
}

/**
 * Mock sync against current seeded sources:
 * - recomputes fingerprints vs prior
 * - extracts only added/changed
 * - appends SyncReport
 * - updates fingerprints + optional graph_stats
 */
export async function runMockSync(opts?: {
  actor?: string;
  forceChangedIds?: string[];
}): Promise<SyncReportRow> {
  await ensureSeeded();
  const sources = await listSources();
  const prior = await getFingerprints();
  const links = await getSourceIndex();
  const actor = opts?.actor || "admin";

  // Optional: mutate content for forceChangedIds so they appear as changed
  const force = new Set(opts?.forceChangedIds || []);
  const nextSources = sources.map((s) => {
    if (!force.has(s.id)) return s;
    const content = `${s.content}\n[touched by ${actor} at ${nowIso()}]`;
    return cloneSource({ ...s, content, content_hash: contentHash(content), last_seen_at: nowIso() });
  });

  const current: Record<string, string> = {};
  for (const s of nextSources) current[s.id] = s.content_hash;
  const change = diffMaps(prior, current);
  const needsExtract = [...change.added, ...change.changed];

  const touched = new Set<string>();
  for (const sid of needsExtract) {
    for (const oid of links[sid] || []) touched.add(oid);
  }
  for (const sid of change.removed) {
    for (const oid of links[sid] || []) touched.add(oid);
  }

  const published = needsExtract.length
    ? [...touched]
    : [];

  const runId = `brand-a-sync-${randomUUID().slice(0, 8)}`;
  const syncedAt = nowIso();

  // Align display with GraphStore SoT (seed/ensure store; do not treat JSON as truth).
  let storeBackend = "file";
  let storeEntityCount = Object.values(links).flat().length || SAMPLE_GRAPH_STATS.entity_count;
  let storeRelCount = SAMPLE_GRAPH_STATS.relation_count;
  try {
    const st = await getStoreStats();
    storeBackend = String(st.backend || st.store_backend || "file");
    storeEntityCount = Number(st.entity_count) || storeEntityCount;
    storeRelCount = Number(st.relationship_count) || storeRelCount;
  } catch {
    const seeded = await seedBrandAGraph();
    storeBackend = String(seeded.backend);
    storeEntityCount = Number(seeded.stats.entity_count) || storeEntityCount;
    storeRelCount = Number(seeded.stats.relationship_count) || storeRelCount;
  }

  // Closed loop: when sources extract/publish, stamp GraphStore entities so explorer reflects sync.
  let publishedIntoStore: string[] = [];
  if (published.length) {
    const pub = await publishTouchedObjects(published, {
      synced_at: syncedAt,
      run_id: runId,
      actor,
      source_ids: needsExtract,
    });
    publishedIntoStore = pub.updated_object_ids;
    storeBackend = String(pub.backend || storeBackend);
    storeEntityCount = Number(pub.stats.entity_count) || storeEntityCount;
    storeRelCount = Number(pub.stats.relationship_count) || storeRelCount;
  }

  const graph_stats: Record<string, unknown> = {
    entity_count: storeEntityCount,
    relation_count: storeRelCount,
    store_backend: storeBackend,
    skipped_unchanged: change.unchanged.length,
    actor,
    published_into_store: publishedIntoStore,
  };

  const report: SyncReportRow = {
    run_id: runId,
    added: change.added,
    changed: change.changed,
    removed: change.removed,
    unchanged: change.unchanged,
    extracted_source_ids: needsExtract,
    touched_object_ids: [...touched].sort(),
    published_object_ids: published.sort(),
    retired_object_ids: [],
    graph_stats,
    at: syncedAt,
  };

  await writeJsonFile(sourcesPath(), { sources: nextSources });
  await writeJsonFile(fingerprintsPath(), { fingerprints: current });
  const runsFile = await readJsonFile<SyncRunsFile>(syncRunsPath(), { runs: [] });
  runsFile.runs = [...(runsFile.runs || []), cloneReport(report)];
  await writeJsonFile(syncRunsPath(), runsFile);
  await writeJsonFile(graphStatsPath(), {
    entity_count: Number(graph_stats.entity_count) || 0,
    relation_count: Number(graph_stats.relation_count) || 0,
    updated_at: report.at,
    store_backend: String(graph_stats.store_backend || storeBackend),
  } satisfies GraphStatsSnapshot);

  return cloneReport(report);
}

export async function appendSyncReport(input: Partial<SyncReportRow> & { run_id?: string }): Promise<SyncReportRow> {
  await ensureSeeded();
  const report: SyncReportRow = {
    run_id: input.run_id || `brand-a-sync-${randomUUID().slice(0, 8)}`,
    added: [...(input.added || [])],
    changed: [...(input.changed || [])],
    removed: [...(input.removed || [])],
    unchanged: [...(input.unchanged || [])],
    extracted_source_ids: [...(input.extracted_source_ids || [])],
    touched_object_ids: [...(input.touched_object_ids || [])],
    published_object_ids: [...(input.published_object_ids || [])],
    retired_object_ids: [...(input.retired_object_ids || [])],
    graph_stats: { ...(input.graph_stats || {}) },
    at: input.at || nowIso(),
  };
  const runsFile = await readJsonFile<SyncRunsFile>(syncRunsPath(), { runs: [] });
  runsFile.runs = [...(runsFile.runs || []), cloneReport(report)];
  await writeJsonFile(syncRunsPath(), runsFile);
  return cloneReport(report);
}
