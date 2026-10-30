/**
 * Admin persistence for ID-Mapping ops (H7).
 * Mirrors Python IdMappingAdminService: profiles, merge conflicts, snapshots.
 * Sample ID types only (phone/email); no customer ID schemas.
 */
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type IdTypeDef = { name: string; priority: number };

export type IdMapProfileRecord = {
  name: string;
  id_types: IdTypeDef[];
  merge: { priority: string[]; on_conflict: "prefer_priority" | "reject" };
};

export type ConflictRecord = {
  id: string;
  snapshot_id: string;
  profile_name: string;
  id_type: string;
  values: unknown[];
  rows: number[];
  status: "open" | "resolved";
  decision: "keep_value" | "reject_merge" | null;
  chosen_value: unknown;
  note: string | null;
  resolved_at: string | null;
};

export type SnapshotPayload = {
  snapshot_id: string;
  as_of?: string | null;
  profile?: string;
  records: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
};

export type SnapshotDiff = {
  left_id: string;
  right_id: string;
  only_left_subject_ids: string[];
  only_right_subject_ids: string[];
  shared_subject_link_changes: Array<{
    subject_id: string;
    only_left: Array<{ id_type: unknown; id_value: unknown }>;
    only_right: Array<{ id_type: unknown; id_value: unknown }>;
  }>;
  left_conflicts: number;
  right_conflicts: number;
};

export type MergeResult = {
  records: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  snapshot_id: string;
  conflicts: Array<Record<string, unknown>>;
};

export const SAMPLE_PROFILE_NAME = "demo_fake_ids";

export const SAMPLE_PROFILE: IdMapProfileRecord = {
  name: SAMPLE_PROFILE_NAME,
  id_types: [
    { name: "phone", priority: 10 },
    { name: "email", priority: 20 },
  ],
  merge: {
    priority: ["email", "phone"],
    on_conflict: "prefer_priority",
  },
};

export const SAMPLE_RECORDS: Array<Record<string, unknown>> = [
  { phone: "138****0001", email: "alice***@example.com", label: "a" },
  { phone: "138****0001", email: "alice.alt***@example.com", label: "b" },
  { phone: "139****0002", email: "bob***@example.com", label: "c" },
];

type ConflictsFile = { conflicts: ConflictRecord[] };

function storeDir(): string {
  const env = process.env.AGX_DATA_SUITE_STORE_DIR?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "../../.runtime/admin/data-suite");
}

function idmapRoot(): string {
  return path.join(storeDir(), "idmapping");
}

function profilesDir(): string {
  return path.join(idmapRoot(), "profiles");
}

function snapshotsDir(): string {
  return path.join(idmapRoot(), "snapshots");
}

function conflictsPath(): string {
  return path.join(idmapRoot(), "conflicts.json");
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(5).toString("hex")}`;
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

function normalizeProfile(raw: Partial<IdMapProfileRecord> & { name?: string }): IdMapProfileRecord {
  const name = String(raw.name || "").trim();
  if (!name) throw new Error("profile name required");
  const id_types = Array.isArray(raw.id_types)
    ? raw.id_types
        .filter((t) => t && typeof t === "object" && String((t as IdTypeDef).name || "").trim())
        .map((t) => ({
          name: String((t as IdTypeDef).name).trim(),
          priority: Number((t as IdTypeDef).priority) || 0,
        }))
    : [];
  if (id_types.length < 1) throw new Error("id_types required");
  const mergeRaw = raw.merge && typeof raw.merge === "object" ? raw.merge : {};
  const priority =
    Array.isArray(mergeRaw.priority) && mergeRaw.priority.length
      ? mergeRaw.priority.map(String)
      : id_types.map((t) => t.name);
  const on_conflict =
    mergeRaw.on_conflict === "reject" ? "reject" : "prefer_priority";
  return { name, id_types, merge: { priority, on_conflict } };
}

async function loadConflicts(): Promise<ConflictRecord[]> {
  const data = await readJsonFile<ConflictsFile>(conflictsPath(), { conflicts: [] });
  return Array.isArray(data.conflicts) ? data.conflicts : [];
}

async function saveConflicts(conflicts: ConflictRecord[]): Promise<void> {
  await writeJsonFile(conflictsPath(), { conflicts });
}

/** Union-find merge mirroring Python IdMappingEngine (simplified). */
export function mergeRecords(
  profile: IdMapProfileRecord,
  records: Array<Record<string, unknown>>,
): Omit<MergeResult, "snapshot_id"> {
  const typeNames = profile.id_types.map((t) => t.name);
  const parent = new Map<string, string>();

  const find = (x: string): string => {
    let cur = x;
    while ((parent.get(cur) ?? cur) !== cur) {
      const p = parent.get(cur) ?? cur;
      parent.set(cur, parent.get(p) ?? p);
      cur = p;
    }
    parent.set(cur, cur);
    return cur;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const rowSubjects: string[] = [];
  records.forEach((rec, i) => {
    const sid = `row-${i}`;
    parent.set(sid, sid);
    rowSubjects.push(sid);
    for (const t of typeNames) {
      const val = rec[t];
      if (val === undefined || val === null || val === "") continue;
      const key = `${t}:${String(val)}`;
      if (!parent.has(key)) parent.set(key, key);
      union(sid, key);
    }
  });

  const groups = new Map<string, number[]>();
  rowSubjects.forEach((sid, i) => {
    const root = find(sid);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  });

  const outRecords: Array<Record<string, unknown>> = [];
  const links: Array<Record<string, unknown>> = [];
  const conflicts: Array<Record<string, unknown>> = [];

  for (const [, idxs] of groups) {
    const byType: Record<string, unknown[]> = {};
    for (const t of typeNames) byType[t] = [];
    for (const i of idxs) {
      for (const t of typeNames) {
        const v = records[i]?.[t];
        if (v === undefined || v === null || v === "") continue;
        if (!byType[t]!.includes(v)) byType[t]!.push(v);
      }
    }

    let skip = false;
    for (const t of typeNames) {
      const vals = byType[t] ?? [];
      if (vals.length > 1) {
        conflicts.push({ id_type: t, values: [...vals], rows: [...idxs] });
        if (profile.merge.on_conflict === "reject") skip = true;
      }
    }
    if (skip) continue;

    let subjectId: string | null = null;
    for (const t of profile.merge.priority) {
      if ((byType[t] ?? []).length) {
        subjectId = `${t}:${String(byType[t]![0])}`;
        break;
      }
    }
    if (!subjectId) subjectId = `anon:${randomBytes(4).toString("hex")}`;

    for (const i of idxs) {
      const row = { ...(records[i] ?? {}), subject_id: subjectId };
      outRecords.push(row);
      for (const t of typeNames) {
        const v = row[t];
        if (v === undefined || v === null || v === "") continue;
        links.push({ subject_id: subjectId, id_type: t, id_value: v });
      }
    }
  }

  return { records: outRecords, links, conflicts };
}

function subjectsOf(payload: SnapshotPayload): Set<string> {
  const out = new Set<string>();
  for (const row of payload.records || []) {
    const sid = row.subject_id;
    if (sid) out.add(String(sid));
  }
  return out;
}

function linksBySubject(payload: SnapshotPayload): Map<string, Array<{ id_type: unknown; id_value: unknown }>> {
  const map = new Map<string, Array<{ id_type: unknown; id_value: unknown }>>();
  for (const link of payload.links || []) {
    const sid = String(link.subject_id || "");
    if (!sid) continue;
    const list = map.get(sid) ?? [];
    list.push({ id_type: link.id_type, id_value: link.id_value });
    map.set(sid, list);
  }
  return map;
}

export function compareSnapshots(left: SnapshotPayload, right: SnapshotPayload): SnapshotDiff {
  const leftSubs = subjectsOf(left);
  const rightSubs = subjectsOf(right);
  const leftLinks = linksBySubject(left);
  const rightLinks = linksBySubject(right);
  const changes: SnapshotDiff["shared_subject_link_changes"] = [];
  for (const sid of [...leftSubs].filter((s) => rightSubs.has(s)).sort()) {
    const lset = new Set((leftLinks.get(sid) ?? []).map((x) => `${x.id_type}\0${x.id_value}`));
    const rset = new Set((rightLinks.get(sid) ?? []).map((x) => `${x.id_type}\0${x.id_value}`));
    if ([...lset].some((x) => !rset.has(x)) || [...rset].some((x) => !lset.has(x))) {
      changes.push({
        subject_id: sid,
        only_left: [...lset]
          .filter((x) => !rset.has(x))
          .map((x) => {
            const [id_type, id_value] = x.split("\0");
            return { id_type, id_value };
          }),
        only_right: [...rset]
          .filter((x) => !lset.has(x))
          .map((x) => {
            const [id_type, id_value] = x.split("\0");
            return { id_type, id_value };
          }),
      });
    }
  }
  return {
    left_id: left.snapshot_id,
    right_id: right.snapshot_id,
    only_left_subject_ids: [...leftSubs].filter((s) => !rightSubs.has(s)).sort(),
    only_right_subject_ids: [...rightSubs].filter((s) => !leftSubs.has(s)).sort(),
    shared_subject_link_changes: changes,
    left_conflicts: (left.conflicts || []).length,
    right_conflicts: (right.conflicts || []).length,
  };
}

export async function listProfiles(): Promise<IdMapProfileRecord[]> {
  await mkdir(profilesDir(), { recursive: true });
  let files: string[] = [];
  try {
    files = await readdir(profilesDir());
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const f of files) {
    if (/\.(ya?ml|json)$/i.test(f)) names.add(f.replace(/\.(ya?ml|json)$/i, ""));
  }
  const out: IdMapProfileRecord[] = [];
  for (const name of [...names].sort()) {
    try {
      out.push(await getProfile(name));
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

export async function getProfile(name: string): Promise<IdMapProfileRecord> {
  const jsonPath = path.join(profilesDir(), `${name}.json`);
  const data = await readJsonFile<Partial<IdMapProfileRecord> | null>(jsonPath, null);
  if (data && typeof data === "object") return normalizeProfile({ ...data, name: data.name || name });
  throw new Error(`unknown profile: ${name}`);
}

export async function saveProfile(raw: Partial<IdMapProfileRecord>): Promise<IdMapProfileRecord> {
  const profile = normalizeProfile(raw);
  await mkdir(profilesDir(), { recursive: true });
  // drop yaml siblings if any (TS store uses JSON)
  for (const ext of ["yaml", "yml"]) {
    try {
      await unlink(path.join(profilesDir(), `${profile.name}.${ext}`));
    } catch {
      /* ignore */
    }
  }
  await writeJsonFile(path.join(profilesDir(), `${profile.name}.json`), profile);
  return profile;
}

export async function ensureSampleProfile(): Promise<IdMapProfileRecord> {
  try {
    return await getProfile(SAMPLE_PROFILE_NAME);
  } catch {
    return saveProfile(SAMPLE_PROFILE);
  }
}

export async function mergeAndEnqueue(
  profileName: string,
  records: Array<Record<string, unknown>>,
): Promise<MergeResult> {
  const profile = await getProfile(profileName);
  const partial = mergeRecords(profile, records);
  const snapshot_id = `idmap-${randomBytes(6).toString("hex")}`;
  const payload: SnapshotPayload = {
    snapshot_id,
    profile: profileName,
    records: partial.records,
    links: partial.links,
    conflicts: partial.conflicts,
  };
  await mkdir(snapshotsDir(), { recursive: true });
  await writeJsonFile(path.join(snapshotsDir(), `${snapshot_id}.json`), payload);

  const conflicts = await loadConflicts();
  for (const c of partial.conflicts) {
    conflicts.push({
      id: newId("cfl"),
      snapshot_id,
      profile_name: profileName,
      id_type: String(c.id_type || ""),
      values: Array.isArray(c.values) ? c.values : [],
      rows: Array.isArray(c.rows) ? (c.rows as number[]) : [],
      status: "open",
      decision: null,
      chosen_value: null,
      note: null,
      resolved_at: null,
    });
  }
  await saveConflicts(conflicts);
  return { ...partial, snapshot_id };
}

export async function listConflicts(status?: "open" | "resolved"): Promise<ConflictRecord[]> {
  const all = await loadConflicts();
  if (!status) return all;
  return all.filter((c) => c.status === status);
}

export async function resolveConflict(input: {
  conflict_id: string;
  decision: "keep_value" | "reject_merge";
  chosen_value?: unknown;
  note?: string;
}): Promise<ConflictRecord> {
  const conflicts = await loadConflicts();
  const found = conflicts.find((c) => c.id === input.conflict_id);
  if (!found) throw new Error(`unknown conflict: ${input.conflict_id}`);
  if (found.status === "resolved") return found;
  if (input.decision === "keep_value") {
    if (input.chosen_value === undefined || input.chosen_value === null) {
      throw new Error("chosen_value required for keep_value");
    }
    if (!found.values.includes(input.chosen_value)) {
      throw new Error("chosen_value must be one of conflict values");
    }
  }
  found.status = "resolved";
  found.decision = input.decision;
  found.chosen_value = input.decision === "keep_value" ? input.chosen_value : null;
  found.note = input.note ?? null;
  found.resolved_at = new Date().toISOString();
  await saveConflicts(conflicts);
  return found;
}

export async function listSnapshotIds(): Promise<string[]> {
  await mkdir(snapshotsDir(), { recursive: true });
  try {
    const files = await readdir(snapshotsDir());
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export async function loadSnapshot(snapshotId: string): Promise<SnapshotPayload> {
  const data = await readJsonFile<SnapshotPayload | null>(
    path.join(snapshotsDir(), `${snapshotId}.json`),
    null,
  );
  if (!data || !data.snapshot_id) throw new Error(`unknown snapshot: ${snapshotId}`);
  return data;
}

export async function getSnapshotCompare(leftId: string, rightId: string): Promise<{
  diff: SnapshotDiff;
  left: SnapshotPayload;
  right: SnapshotPayload;
}> {
  const left = await loadSnapshot(leftId);
  const right = await loadSnapshot(rightId);
  return { diff: compareSnapshots(left, right), left, right };
}

export async function resetIdmappingStoreForTests(): Promise<void> {
  await mkdir(idmapRoot(), { recursive: true });
  await writeJsonFile(conflictsPath(), { conflicts: [] });
  await mkdir(profilesDir(), { recursive: true });
  await mkdir(snapshotsDir(), { recursive: true });
  try {
    const pfiles = await readdir(profilesDir());
    await Promise.all(pfiles.map((f) => unlink(path.join(profilesDir(), f)).catch(() => undefined)));
  } catch {
    /* empty */
  }
  try {
    const sfiles = await readdir(snapshotsDir());
    await Promise.all(sfiles.map((f) => unlink(path.join(snapshotsDir(), f)).catch(() => undefined)));
  } catch {
    /* empty */
  }
}
