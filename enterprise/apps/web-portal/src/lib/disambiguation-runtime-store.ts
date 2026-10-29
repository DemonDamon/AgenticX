/**
 * Portal runtime disambiguation store.
 * Mirrors agenticx.runtime.disambiguation session JSON — separate from
 * admin-console `.runtime/admin/disambiguation`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SAMPLE_DISAMBIGUATION_SESSIONS,
  type DisambiguationMode,
  type DisambiguationRequest,
  type DisambiguationResponse,
  type DisambiguationSession,
  type DisambiguationSessionStatus,
} from "./disambiguation-types";

export type {
  DisambiguationMode,
  DisambiguationRequest,
  DisambiguationResponse,
  DisambiguationSession,
  DisambiguationSessionStatus,
} from "./disambiguation-types";
export { SAMPLE_DISAMBIGUATION_SESSIONS, buildSampleSessions } from "./disambiguation-types";

type SessionsFile = { sessions: DisambiguationSession[] };

/** Runtime sessions (agenticx.runtime.disambiguation) — NOT admin JSON store. */
export function resolveRuntimeStoreDir(): string {
  return storeDir();
}

function storeDir(): string {
  const runtimeEnv = process.env.AGX_DISAMBIGUATION_RUNTIME_STORE_DIR?.trim();
  if (runtimeEnv) return runtimeEnv;
  // Prefer explicit runtime env; fall back only when AGX_DISAMBIGUATION_STORE_DIR
  // is set AND points outside the admin subtree (avoid colliding with admin UI).
  const shared = process.env.AGX_DISAMBIGUATION_STORE_DIR?.trim();
  if (shared && !shared.replace(/\\/g, "/").includes("/admin/disambiguation")) {
    return shared;
  }
  // web-portal cwd → repo-root/.runtime/disambiguation (Python DisambiguationFileStore default shape)
  return path.resolve(process.cwd(), "../../../.runtime/disambiguation");
}

function sessionsPath(): string {
  return path.join(storeDir(), "sessions.json");
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

function cloneSession(s: DisambiguationSession): DisambiguationSession {
  return JSON.parse(JSON.stringify(s)) as DisambiguationSession;
}

export function validateRequest(req: DisambiguationRequest): void {
  if (!req.id) throw new Error("request.id is required");
  if (req.mode === "candidate_select" && (!req.candidates || req.candidates.length < 1)) {
    throw new Error("candidate_select requires ≥1 candidate");
  }
  if (req.mode === "info_supplement" && !req.allow_free_text) {
    throw new Error("info_supplement requires allow_free_text=True");
  }
  if (
    req.mode === "conflict_resolve" &&
    (!req.conflicts || req.conflicts.length < 1) &&
    (!req.candidates || req.candidates.length < 1)
  ) {
    throw new Error("conflict_resolve requires ≥1 conflict or candidate");
  }
}

export function validateResponse(req: DisambiguationRequest, resp: DisambiguationResponse): void {
  if (resp.request_id !== req.id) {
    throw new Error(`response.request_id ${resp.request_id} != request.id ${req.id}`);
  }
  if (resp.cancelled) return;
  if (req.mode === "candidate_select") {
    if (!resp.selected_ids?.length) throw new Error("candidate_select response needs selected_ids");
    const known = new Set(req.candidates.map((c) => c.id));
    const unknown = resp.selected_ids.filter((i) => !known.has(i));
    if (unknown.length) throw new Error(`unknown selected_ids: ${unknown.join(",")}`);
  } else if (req.mode === "info_supplement") {
    if (!(resp.free_text || "").trim()) throw new Error("info_supplement response needs free_text");
  } else if (req.mode === "conflict_resolve") {
    const hasPick = Boolean(resp.selected_ids?.length) || Boolean((resp.free_text || "").trim());
    if (!hasPick) throw new Error("conflict_resolve response needs selected_ids or free_text");
    if (resp.selected_ids?.length && req.candidates.length) {
      const known = new Set(req.candidates.map((c) => c.id));
      const unknown = resp.selected_ids.filter((i) => !known.has(i));
      if (unknown.length) throw new Error(`unknown selected_ids: ${unknown.join(",")}`);
    }
  }
}

function slotValue(req: DisambiguationRequest, resp: DisambiguationResponse): unknown {
  if (resp.cancelled) return null;
  if (resp.selected_ids?.length) {
    const byId = new Map(req.candidates.map((c) => [c.id, c]));
    const picked = resp.selected_ids.map((i) => byId.get(i)).filter(Boolean) as {
      id: string;
      label: string;
    }[];
    if (picked.length === 1) return picked[0]!.label || picked[0]!.id;
    if (picked.length) return picked.map((p) => p.label || p.id);
    return [...resp.selected_ids];
  }
  if (resp.free_text != null) return String(resp.free_text).trim();
  return null;
}

async function ensureSeed(): Promise<SessionsFile> {
  const file = sessionsPath();
  try {
    await readFile(file, "utf-8");
    return await readJsonFile<SessionsFile>(file, {
      sessions: SAMPLE_DISAMBIGUATION_SESSIONS.map(cloneSession),
    });
  } catch {
    const seeded: SessionsFile = {
      sessions: SAMPLE_DISAMBIGUATION_SESSIONS.map(cloneSession),
    };
    await writeJsonFile(file, seeded);
    return seeded;
  }
}

export async function listSessions(opts?: {
  status?: DisambiguationSessionStatus;
  source?: string;
}): Promise<DisambiguationSession[]> {
  const data = await ensureSeed();
  let rows = (data.sessions ?? []).map(cloneSession);
  if (opts?.status) rows = rows.filter((s) => s.status === opts.status);
  if (opts?.source) rows = rows.filter((s) => s.source === opts.source);
  return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export async function getSession(sessionId: string): Promise<DisambiguationSession | null> {
  const rows = await listSessions();
  return rows.find((s) => s.id === sessionId) ?? null;
}

export async function upsertSession(session: DisambiguationSession): Promise<DisambiguationSession> {
  const data = await ensureSeed();
  const sessions = [...(data.sessions ?? [])];
  const idx = sessions.findIndex((s) => s.id === session.id);
  const next = cloneSession({ ...session, updated_at: nowIso() });
  if (idx < 0) sessions.push(next);
  else sessions[idx] = next;
  await writeJsonFile(sessionsPath(), { sessions });
  return cloneSession(next);
}

export async function createSession(input: {
  source: string;
  pending?: DisambiguationRequest[];
  meta?: Record<string, unknown>;
  session_id?: string;
}): Promise<DisambiguationSession> {
  const stamp = nowIso();
  const sid = input.session_id || `das-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const pending = (input.pending || []).map((r) => {
    const req = { ...r, session_id: r.session_id || sid };
    validateRequest(req);
    return req;
  });
  const sess: DisambiguationSession = {
    id: sid,
    status: "open",
    source: input.source,
    pending,
    resolved: [],
    slots: {},
    created_at: stamp,
    updated_at: stamp,
    meta: { ...(input.meta || {}) },
  };
  return upsertSession(sess);
}

export async function applyResponse(
  sessionId: string,
  resp: DisambiguationResponse,
): Promise<DisambiguationSession> {
  const data = await ensureSeed();
  const sessions = [...(data.sessions ?? [])];
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) throw new Error(`session not found: ${sessionId}`);
  const session = cloneSession(sessions[idx]!);
  if (session.status !== "open") throw new Error(`session ${sessionId} is ${session.status}`);
  const matchIdx = session.pending.findIndex((r) => r.id === resp.request_id);
  if (matchIdx < 0) throw new Error(`no pending request ${resp.request_id}`);
  const req = session.pending[matchIdx]!;
  validateResponse(req, resp);
  if (resp.cancelled) {
    session.status = "cancelled";
    session.resolved.push({ request: req, response: resp });
    session.pending = [];
  } else {
    const value = slotValue(req, resp);
    if (req.field) session.slots[req.field] = value;
    session.resolved.push({ request: req, response: resp });
    session.pending.splice(matchIdx, 1);
    if (!session.pending.length) session.status = "completed";
  }
  session.updated_at = nowIso();
  sessions[idx] = session;
  await writeJsonFile(sessionsPath(), { sessions });
  return cloneSession(session);
}

export async function reseedSamples(): Promise<DisambiguationSession[]> {
  const seeded = SAMPLE_DISAMBIGUATION_SESSIONS.map(cloneSession);
  await writeJsonFile(sessionsPath(), { sessions: seeded });
  return seeded.map(cloneSession);
}
