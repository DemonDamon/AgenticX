import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runQualityChecks } from "./knowledge-lifecycle-quality";
import {
  ALLOWED_ISSUE_TRANSITIONS,
  ALLOWED_OBJECT_TRANSITIONS,
  SAMPLE_KNOWLEDGE_OBJECTS,
  type ChangeEventRow,
  type IssueStatus,
  type KnowledgeIssueRow,
  type KnowledgeObjectRow,
  type KnowledgeStatus,
  type QualityFindingRow,
} from "./knowledge-lifecycle-types";

export type {
  ChangeEventRow,
  IssueStatus,
  KnowledgeIssueRow,
  KnowledgeObjectRow,
  KnowledgeStatus,
  QualityFindingRow,
} from "./knowledge-lifecycle-types";
export { SAMPLE_KNOWLEDGE_OBJECTS } from "./knowledge-lifecycle-types";

type ObjectsFile = { objects: KnowledgeObjectRow[] };
type IssuesFile = { issues: KnowledgeIssueRow[] };
type ChangesFile = { events: ChangeEventRow[] };

function storeDir(): string {
  const env = process.env.AGX_KNOWLEDGE_LIFECYCLE_STORE_DIR?.trim();
  if (env) return env;
  return path.resolve(process.cwd(), "../../.runtime/admin/knowledge-lifecycle");
}

function objectsPath(): string {
  return path.join(storeDir(), "objects.json");
}
function issuesPath(): string {
  return path.join(storeDir(), "issues.json");
}
function changesPath(): string {
  return path.join(storeDir(), "changes.json");
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
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

function cloneObject(row: KnowledgeObjectRow): KnowledgeObjectRow {
  return {
    ...row,
    attrs: { ...row.attrs },
    relations: row.relations.map((r) => ({ ...r })),
    source_ids: [...row.source_ids],
    meta: { ...row.meta },
  };
}

function fingerprint(objectId: string, code: string, message: string): string {
  return createHash("sha256").update(`${objectId}|${code}|${message}`).digest("hex").slice(0, 16);
}

async function ensureObjectsSeed(): Promise<ObjectsFile> {
  const file = objectsPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<ObjectsFile>(file, { objects: SAMPLE_KNOWLEDGE_OBJECTS.map(cloneObject) });
  } catch {
    const seeded: ObjectsFile = { objects: SAMPLE_KNOWLEDGE_OBJECTS.map(cloneObject) };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function ensureIssuesSeed(): Promise<IssuesFile> {
  const file = issuesPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<IssuesFile>(file, { issues: [] });
  } catch {
    const seeded: IssuesFile = { issues: [] };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function ensureChangesSeed(): Promise<ChangesFile> {
  const file = changesPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<ChangesFile>(file, { events: [] });
  } catch {
    const seeded: ChangesFile = { events: [] };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

async function appendChange(event: Omit<ChangeEventRow, "id" | "at"> & { id?: string; at?: string }): Promise<ChangeEventRow> {
  const data = await ensureChangesSeed();
  const row: ChangeEventRow = {
    id: event.id || randomUUID(),
    object_id: event.object_id,
    action: event.action,
    actor: event.actor || "system",
    from_status: event.from_status ?? null,
    to_status: event.to_status ?? null,
    detail: { ...(event.detail || {}) },
    at: event.at || nowIso(),
  };
  data.events.push(row);
  await writeJsonFile(changesPath(), data);
  return row;
}

function transitionAction(fromStatus: string, toStatus: string): string {
  if (toStatus === "retired") return "retire";
  if (fromStatus === "retired" && toStatus === "draft") return "reopen";
  return "transition";
}

export async function listObjects(status?: KnowledgeStatus): Promise<KnowledgeObjectRow[]> {
  const data = await ensureObjectsSeed();
  let rows = (data.objects ?? []).map(cloneObject);
  if (status) rows = rows.filter((r) => r.status === status);
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export async function getObject(objectId: string): Promise<KnowledgeObjectRow | null> {
  const rows = await listObjects();
  return rows.find((r) => r.id === objectId) ?? null;
}

export async function upsertObject(
  input: Partial<KnowledgeObjectRow> & { id: string; kind: string },
  opts?: { actor?: string; bumpVersion?: boolean },
): Promise<KnowledgeObjectRow> {
  const id = input.id.trim();
  const kind = input.kind.trim();
  if (!id || !kind) throw new Error("id and kind required");
  const data = await ensureObjectsSeed();
  const objects = [...(data.objects ?? [])];
  const idx = objects.findIndex((o) => o.id === id);
  const stamp = nowIso();
  const actor = opts?.actor || "admin";
  let stored: KnowledgeObjectRow;
  if (idx < 0) {
    stored = {
      id,
      kind,
      status: (input.status as KnowledgeStatus) || "draft",
      version: Math.max(1, Number(input.version) || 1),
      attrs: { ...(input.attrs || {}) },
      relations: (input.relations || []).map((r) => ({ ...r })),
      source_ids: [...(input.source_ids || [])],
      meta: { ...(input.meta || {}) },
      created_at: input.created_at || stamp,
      updated_at: stamp,
    };
    objects.push(stored);
    await appendChange({
      object_id: id,
      action: "create",
      actor,
      from_status: null,
      to_status: stored.status,
      detail: { version: stored.version, kind: stored.kind },
    });
  } else {
    const existing = objects[idx]!;
    const version = opts?.bumpVersion
      ? existing.version + 1
      : Math.max(existing.version, Number(input.version) || existing.version);
    stored = {
      id,
      kind,
      status: (input.status as KnowledgeStatus) || existing.status,
      version,
      attrs: { ...(input.attrs ?? existing.attrs) },
      relations: (input.relations ?? existing.relations).map((r) => ({ ...r })),
      source_ids: [...(input.source_ids ?? existing.source_ids)],
      meta: { ...(input.meta ?? existing.meta) },
      created_at: existing.created_at,
      updated_at: stamp,
    };
    objects[idx] = stored;
    await appendChange({
      object_id: id,
      action: "update",
      actor,
      from_status: existing.status,
      to_status: stored.status,
      detail: { version: stored.version, kind: stored.kind },
    });
  }
  objects.sort((a, b) => a.id.localeCompare(b.id));
  await writeJsonFile(objectsPath(), { objects });
  return cloneObject(stored);
}

export async function transitionObject(
  objectId: string,
  to: KnowledgeStatus,
  opts?: { actor?: string },
): Promise<KnowledgeObjectRow> {
  const data = await ensureObjectsSeed();
  const objects = [...(data.objects ?? [])];
  const idx = objects.findIndex((o) => o.id === objectId);
  if (idx < 0) throw new Error(`object not found: ${objectId}`);
  const current = objects[idx]!;
  const allowed = ALLOWED_OBJECT_TRANSITIONS[current.status] || [];
  if (!allowed.includes(to)) {
    throw new Error(`cannot transition ${objectId} from ${current.status} to ${to}`);
  }
  const stamp = nowIso();
  const updated: KnowledgeObjectRow = { ...cloneObject(current), status: to, updated_at: stamp };
  objects[idx] = updated;
  await writeJsonFile(objectsPath(), { objects });
  const actor = opts?.actor || "admin";
  await appendChange({
    object_id: objectId,
    action: transitionAction(current.status, to),
    actor,
    from_status: current.status,
    to_status: to,
    detail: {},
  });
  return cloneObject(updated);
}

export async function listIssues(opts?: {
  objectId?: string;
  status?: IssueStatus;
}): Promise<KnowledgeIssueRow[]> {
  const data = await ensureIssuesSeed();
  let rows = [...(data.issues ?? [])];
  if (opts?.objectId) rows = rows.filter((i) => i.object_id === opts.objectId);
  if (opts?.status) rows = rows.filter((i) => i.status === opts.status);
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listTrail(objectId?: string): Promise<ChangeEventRow[]> {
  const data = await ensureChangesSeed();
  let rows = [...(data.events ?? [])];
  if (objectId) rows = rows.filter((e) => e.object_id === objectId);
  return rows;
}

export async function openIssuesFromFindings(findings: QualityFindingRow[]): Promise<KnowledgeIssueRow[]> {
  const data = await ensureIssuesSeed();
  const issues = [...(data.issues ?? [])];
  const openish = new Map(
    issues
      .filter((i) => i.status === "open" || i.status === "in_progress")
      .map((i) => [i.fingerprint || fingerprint(i.object_id, i.code, i.message), i]),
  );
  const created: KnowledgeIssueRow[] = [];
  const stamp = nowIso();
  for (const f of findings) {
    const fp = fingerprint(f.object_id, f.code, f.message);
    if (openish.has(fp)) continue;
    const existingAny = issues.find((i) => (i.fingerprint || fingerprint(i.object_id, i.code, i.message)) === fp);
    if (existingAny && (existingAny.status === "resolved" || existingAny.status === "waived")) {
      const updated: KnowledgeIssueRow = {
        ...existingAny,
        status: "open",
        updated_at: stamp,
        resolved_by: "",
        message: f.message,
        detail: { ...f.detail },
        severity: f.severity,
      };
      const idx = issues.findIndex((i) => i.id === existingAny.id);
      issues[idx] = updated;
      openish.set(fp, updated);
      created.push(updated);
      continue;
    }
    const row: KnowledgeIssueRow = {
      id: randomUUID(),
      object_id: f.object_id,
      code: f.code,
      severity: f.severity,
      status: "open",
      message: f.message,
      detail: { ...f.detail },
      created_at: stamp,
      updated_at: stamp,
      resolved_by: "",
      fingerprint: fp,
    };
    issues.push(row);
    openish.set(fp, row);
    created.push(row);
  }
  issues.sort((a, b) => a.id.localeCompare(b.id));
  await writeJsonFile(issuesPath(), { issues });
  return created;
}

export async function transitionIssue(
  issueId: string,
  to: IssueStatus,
  opts?: { actor?: string },
): Promise<KnowledgeIssueRow> {
  const data = await ensureIssuesSeed();
  const issues = [...(data.issues ?? [])];
  const idx = issues.findIndex((i) => i.id === issueId);
  if (idx < 0) throw new Error(`issue not found: ${issueId}`);
  const current = issues[idx]!;
  const allowed = ALLOWED_ISSUE_TRANSITIONS[current.status] || [];
  if (!allowed.includes(to)) {
    throw new Error(`cannot transition issue ${issueId} from ${current.status} to ${to}`);
  }
  const stamp = nowIso();
  let resolvedBy = current.resolved_by || "";
  if (to === "resolved" || to === "waived") resolvedBy = opts?.actor || resolvedBy || "system";
  else if (to === "open") resolvedBy = "";
  const updated: KnowledgeIssueRow = {
    ...current,
    status: to,
    updated_at: stamp,
    resolved_by: resolvedBy,
  };
  issues[idx] = updated;
  await writeJsonFile(issuesPath(), { issues });
  return { ...updated };
}

export async function runQualityAndOpenIssues(policy?: Parameters<typeof runQualityChecks>[1]): Promise<{
  findings: QualityFindingRow[];
  opened: KnowledgeIssueRow[];
}> {
  const objects = await listObjects();
  const findings = runQualityChecks(objects, policy);
  const opened = await openIssuesFromFindings(findings);
  return { findings, opened };
}
