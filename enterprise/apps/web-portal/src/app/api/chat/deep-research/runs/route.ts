import { NextResponse } from "next/server";
import type { DeepResearchEvent } from "@agenticx/sdk-ts";
import { getSessionFromCookies } from "../../../../../lib/session";
import { defaultArtifactStore } from "../../../../../lib/deep-research/artifact-store";
import {
  defaultRunStore,
  runLooksFinished,
  type RunRecord,
} from "../../../../../lib/deep-research/run-store";
import { withRequestLog } from "../../../../../lib/observability/with-request-log";

export const runtime = "nodejs";

const MAX_HYDRATE_EVENTS = 200;

/** 活跃 run 超过该时长无事件落库 → 判定为死亡（handler 被杀/用户关页），服务端收割。 */
const STALE_ACTIVE_RUN_MS = 30 * 60_000;
/** 收割是全局扫描，按进程节流，避免横幅轮询放大成全表 UPDATE。 */
const REAP_INTERVAL_MS = 60_000;
let lastReapAt = 0;

async function reapStaleRunsThrottled(): Promise<void> {
  const now = Date.now();
  if (now - lastReapAt < REAP_INTERVAL_MS) return;
  lastReapAt = now;
  try {
    const reaped = await defaultRunStore.reapStaleRuns(STALE_ACTIVE_RUN_MS);
    if (reaped > 0) {
      console.info("[deep-research] reaped stale active runs:", reaped);
    }
  } catch (error) {
    console.warn(
      "[deep-research] reap stale runs failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

function isReportArtifact(path: string, kind: string): boolean {
  if (kind === "report") return true;
  const lower = path.toLowerCase();
  return lower.includes("final-report") || lower.endsWith("/report.md") || lower.endsWith("/report.html");
}

async function runHasStoredReport(
  row: Pick<RunRecord, "tenantId" | "userId" | "runId" | "phase" | "events" | "reportMarkdown">,
): Promise<boolean> {
  if (runLooksFinished(row)) return true;
  try {
    const arts = await defaultArtifactStore.listByRun(row.tenantId, row.userId, row.runId);
    return arts.some((a) => isReportArtifact(a.path, a.kind));
  } catch {
    return false;
  }
}

/** Merge report artifacts from artifact-store into events when flush never recorded them. */
async function enrichRowWithStoredArtifacts(row: RunRecord): Promise<RunRecord> {
  try {
    const arts = await defaultArtifactStore.listByRun(row.tenantId, row.userId, row.runId);
    if (arts.length === 0) return row;
    const existing = new Set(
      row.events
        .filter((e): e is Extract<DeepResearchEvent, { type: "artifact" }> => e.type === "artifact")
        .map((e) => e.id),
    );
    const extras: DeepResearchEvent[] = [];
    for (const art of arts) {
      if (existing.has(art.id)) continue;
      // Prefer report/memo deliverables; skip raw page dumps for workbench noise.
      if (art.kind !== "report" && art.kind !== "memo") continue;
      extras.push({
        type: "artifact",
        id: art.id,
        path: art.path,
        title: art.title,
        kind: art.kind,
        bytes: art.byteSize,
      });
    }
    if (extras.length === 0) return row;
    return { ...row, events: [...row.events, ...extras] };
  } catch {
    return row;
  }
}

function toHydratePayload(row: RunRecord) {
  const artifactIds = row.events
    .filter((e): e is Extract<DeepResearchEvent, { type: "artifact" }> => e.type === "artifact")
    .map((e) => e.id)
    .filter((id): id is string => typeof id === "string")
    .slice(0, 40);
  const finished = runLooksFinished(row);
  const status = finished && row.status === "running" ? "completed" : row.status;
  return {
    runId: row.runId,
    sessionId: row.sessionId,
    status,
    phase: status === "completed" || status === "failed" || status === "cancelled" ? "done" : row.phase,
    topic: row.topic,
    updatedAt: row.updatedAt,
    events: row.events.slice(-MAX_HYDRATE_EVENTS),
    artifactIds: artifactIds.length > 0 ? artifactIds : undefined,
  };
}

/** Close out runs that already delivered a report but never reached `finish()`. */
async function healFinishedActiveRuns(rows: RunRecord[]): Promise<RunRecord[]> {
  const stillActive: RunRecord[] = [];
  for (const row of rows) {
    const done = await runHasStoredReport(row);
    if (!done) {
      stillActive.push(row);
      continue;
    }
    try {
      await defaultRunStore.finish(row.runId, "completed");
    } catch (error) {
      console.warn(
        "[deep-research] heal finish failed:",
        row.runId,
        error instanceof Error ? error.message : error,
      );
      // Still hide from the recover banner — client already has deliverables.
    }
  }
  return stillActive;
}

export async function GET(request: Request) {
  return withRequestLog("deep_research.runs", async (logCtx) => {
  const session = await getSessionFromCookies();
  if (!session) {
    return NextResponse.json(
      { error: { code: "40101", message: "unauthorized" } },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
  const hydrate = url.searchParams.get("hydrate") === "1";
  logCtx.setUser({
    userId: session.userId,
    tenantId: session.tenantId,
    sessionId,
  });
  logCtx.setMode("deep_research");
  const store = defaultRunStore;
  await reapStaleRunsThrottled();
  const activeRaw = await store.listActive(session.tenantId, session.userId, sessionId);
  const active = await healFinishedActiveRuns(activeRaw);

  let latest: ReturnType<typeof toHydratePayload> | null = null;
  if (hydrate && sessionId) {
    const raw = await store.getLatestBySession(session.tenantId, session.userId, sessionId);
    if (raw && (raw.events.length > 0 || raw.reportMarkdown.trim().length > 0)) {
      const row = await enrichRowWithStoredArtifacts(raw);
      if ((await runHasStoredReport(row)) && row.status === "running") {
        try {
          await store.finish(row.runId, "completed");
        } catch {
          // ignore — hydrate payload still marks completed via toHydratePayload
        }
      }
      const finished = await runHasStoredReport(row);
      latest = toHydratePayload(
        finished && row.status === "running"
          ? { ...row, status: "completed", phase: "done" }
          : row,
      );
    }
  }

  return NextResponse.json({
    code: "00000",
    message: "ok",
    data: {
      runs: active.map((row) => ({
        runId: row.runId,
        sessionId: row.sessionId,
        status: row.status,
        phase: row.phase,
        topic: row.topic,
        updatedAt: row.updatedAt,
      })),
      ...(hydrate ? { latest } : {}),
    },
  });
  }, request);
}
