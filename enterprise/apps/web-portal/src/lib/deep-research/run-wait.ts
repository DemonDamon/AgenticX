/**
 * Clarify resume coordination for deep-research.
 *
 * Uses both an in-memory waiter (fast path) and a small JSON file under
 * enterprise/.runtime so resume still works across Next.js HMR / isolate
 * boundaries. A pure in-memory Map was cleared on hot reload while the SSE
 * request kept waiting — the clarify card then got "alreadyContinued" and
 * showed a false timeout within the real deadline.
 */

import fs from "node:fs";
import path from "node:path";

export type ClarifyResumePayload = {
  answers: Record<string, string>;
  skip: boolean;
  timedOut?: boolean;
};

/** clarify_chat 回复在 answers 中的键（对话式澄清无 questionId）。 */
export const CHAT_CLARIFY_ANSWER_KEY = "__chat__";
/** 计划 gate 动作（approve/edit/skip）在 answers 中的键。 */
export const PLAN_GATE_ACTION_KEY = "__plan_action__";
/** 计划 gate 编辑补丁（JSON string，仅 subQuestions 白名单）在 answers 中的键。 */
export const PLAN_GATE_PATCH_KEY = "__plan_patch__";

/** 单条答案 / chat 回复 / 计划补丁的长度上限（防滥用）。 */
export const MAX_GATE_ANSWER_CHARS = 2_000;
export const MAX_PLAN_PATCH_CHARS = 4_000;

type Waiter = {
  resolve: (value: ClarifyResumePayload) => void;
  reject: (reason?: unknown) => void;
  /** null = indefinite wait (no auto timeout). */
  timer: ReturnType<typeof setTimeout> | null;
  poll: ReturnType<typeof setInterval>;
  settled: boolean;
};

type PendingFile = {
  status: "waiting" | "resolved";
  updatedAt: number;
  payload?: ClarifyResumePayload;
};

type ClarifyGlobal = typeof globalThis & {
  __agxClarifyWaiters?: Map<string, Waiter>;
  __agxClarifyWaitDir?: string;
};

function clarifyGlobal(): ClarifyGlobal {
  return globalThis as ClarifyGlobal;
}

function waiters(): Map<string, Waiter> {
  const g = clarifyGlobal();
  if (!g.__agxClarifyWaiters) g.__agxClarifyWaiters = new Map();
  return g.__agxClarifyWaiters;
}

export function resolveClarifyWaitDir(cwd = process.cwd()): string {
  const override = process.env.AGX_CLARIFY_WAIT_DIR?.trim();
  if (override) return path.resolve(override);
  const g = clarifyGlobal();
  if (g.__agxClarifyWaitDir) return g.__agxClarifyWaitDir;
  const candidates = [
    path.resolve(cwd, ".runtime/deep-research-clarify"),
    path.resolve(cwd, "../../.runtime/deep-research-clarify"),
  ];
  for (const candidate of candidates) {
    const enterpriseRuntime = path.dirname(candidate);
    if (fs.existsSync(enterpriseRuntime) || candidate.includes(`${path.sep}.runtime${path.sep}`)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

/** Test helper: pin wait dir (also sets AGX_CLARIFY_WAIT_DIR). */
export function setClarifyWaitDirForTests(dir: string | null): void {
  const g = clarifyGlobal();
  if (dir) {
    g.__agxClarifyWaitDir = path.resolve(dir);
    process.env.AGX_CLARIFY_WAIT_DIR = g.__agxClarifyWaitDir;
  } else {
    delete g.__agxClarifyWaitDir;
    delete process.env.AGX_CLARIFY_WAIT_DIR;
  }
}

function pendingPath(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
  return path.join(resolveClarifyWaitDir(), `${safe}.json`);
}

function ensureWaitDir(): void {
  fs.mkdirSync(resolveClarifyWaitDir(), { recursive: true });
}

function writePending(runId: string, doc: PendingFile): void {
  ensureWaitDir();
  const file = pendingPath(runId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc), "utf8");
  fs.renameSync(tmp, file);
}

function readPending(runId: string): PendingFile | null {
  try {
    const raw = fs.readFileSync(pendingPath(runId), "utf8");
    const parsed = JSON.parse(raw) as PendingFile;
    if (parsed?.status !== "waiting" && parsed?.status !== "resolved") return null;
    return parsed;
  } catch {
    return null;
  }
}

function removePending(runId: string): void {
  try {
    fs.unlinkSync(pendingPath(runId));
  } catch {
    // ignore
  }
}

function settleWaiter(runId: string, payload: ClarifyResumePayload): void {
  const waiter = waiters().get(runId);
  if (!waiter || waiter.settled) {
    if (payload.timedOut) removePending(runId);
    return;
  }
  waiter.settled = true;
  if (waiter.timer !== null) clearTimeout(waiter.timer);
  clearInterval(waiter.poll);
  waiters().delete(runId);
  removePending(runId);
  waiter.resolve(payload);
}

/**
 * Wait until resume resolves this run's gate.
 * `timeoutMs <= 0` or non-finite → **indefinite** (no auto timeout); used by plan_chat gate.
 */
export function waitForClarifyResume(
  runId: string,
  timeoutMs: number,
): Promise<ClarifyResumePayload> {
  const existing = waiters().get(runId);
  if (existing && !existing.settled) {
    existing.settled = true;
    if (existing.timer !== null) clearTimeout(existing.timer);
    clearInterval(existing.poll);
    waiters().delete(runId);
    // Prefer resolve-skip over reject to avoid unhandled rejections when the
    // previous waiter's Promise is no longer awaited (tests / orphan reopen).
    existing.resolve({ answers: {}, skip: true, timedOut: true });
  }

  writePending(runId, { status: "waiting", updatedAt: Date.now() });

  return new Promise<ClarifyResumePayload>((resolve, reject) => {
    const indefinite = !(timeoutMs > 0 && Number.isFinite(timeoutMs));
    const timer = indefinite
      ? null
      : setTimeout(() => {
          settleWaiter(runId, { answers: {}, skip: true, timedOut: true });
        }, timeoutMs);

    const poll = setInterval(() => {
      const doc = readPending(runId);
      if (doc?.status === "resolved" && doc.payload) {
        const next: ClarifyResumePayload = {
          answers: doc.payload.answers ?? {},
          skip: Boolean(doc.payload.skip),
        };
        if (doc.payload.timedOut) next.timedOut = true;
        settleWaiter(runId, next);
      }
    }, 200);

    waiters().set(runId, {
      resolve,
      reject,
      timer,
      poll,
      settled: false,
    });
  });
}

export function resolveClarifyResume(runId: string, payload: ClarifyResumePayload): boolean {
  const doc = readPending(runId);
  const memoryWaiter = waiters().get(runId);
  const wasWaiting =
    doc?.status === "waiting" || Boolean(memoryWaiter && !memoryWaiter.settled);

  if (!wasWaiting) {
    return false;
  }

  writePending(runId, {
    status: "resolved",
    updatedAt: Date.now(),
    payload: {
      answers: payload.answers ?? {},
      skip: Boolean(payload.skip),
      timedOut: Boolean(payload.timedOut),
    },
  });

  if (memoryWaiter && !memoryWaiter.settled) {
    const next: ClarifyResumePayload = {
      answers: payload.answers ?? {},
      skip: Boolean(payload.skip),
    };
    if (payload.timedOut) next.timedOut = true;
    settleWaiter(runId, next);
  }
  return true;
}

export function hasClarifyWaiter(runId: string): boolean {
  const memory = waiters().get(runId);
  if (memory && !memory.settled) return true;
  return readPending(runId)?.status === "waiting";
}

/**
 * True only when THIS process still holds the Promise waiter.
 * Disk `waiting` alone does not count — after full process restart the file may
 * linger while nobody is listening; orphan recovery must still be allowed.
 */
export function hasLiveClarifyWaiter(runId: string): boolean {
  const memory = waiters().get(runId);
  return Boolean(memory && !memory.settled);
}

/**
 * After resolveClarifyResume wrote disk `resolved` with no in-process waiter,
 * wait for a peer isolate's poller to consume it (file removed).
 * - delivered: peer settled the gate
 * - stale: still resolved / untouched after timeout → nobody listening (orphan OK)
 */
export async function awaitPeerClarifyHandoff(
  runId: string,
  timeoutMs = 800,
): Promise<"delivered" | "stale"> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() <= deadline) {
    const doc = readPending(runId);
    if (!doc) return "delivered";
    if (doc.status === "waiting") return "stale";
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return readPending(runId) ? "stale" : "delivered";
}

/** Test helper */
export function clearClarifyWaiters(): void {
  for (const [runId, waiter] of waiters()) {
    if (waiter.settled) {
      removePending(runId);
      continue;
    }
    waiter.settled = true;
    if (waiter.timer !== null) clearTimeout(waiter.timer);
    clearInterval(waiter.poll);
    removePending(runId);
    // Resolve (skip) instead of reject: rejecting orphaned indefinite waits
    // surfaces as Vitest "Unhandled Rejection" when tests fire-and-forget
    // waitForClarifyResume. Skip unblocks orchestrator loops cleanly.
    try {
      waiter.resolve({ answers: {}, skip: true, timedOut: true });
    } catch {
      // already settled
    }
  }
  waiters().clear();
  const dir = resolveClarifyWaitDir();
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".json")) fs.unlinkSync(path.join(dir, name));
    }
  } catch {
    // ignore
  }
}
