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

type Waiter = {
  resolve: (value: ClarifyResumePayload) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
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
  clearTimeout(waiter.timer);
  clearInterval(waiter.poll);
  waiters().delete(runId);
  removePending(runId);
  waiter.resolve(payload);
}

export function waitForClarifyResume(
  runId: string,
  timeoutMs: number,
): Promise<ClarifyResumePayload> {
  const existing = waiters().get(runId);
  if (existing && !existing.settled) {
    existing.settled = true;
    clearTimeout(existing.timer);
    clearInterval(existing.poll);
    waiters().delete(runId);
    existing.reject(new Error("clarify waiter replaced"));
  }

  writePending(runId, { status: "waiting", updatedAt: Date.now() });

  return new Promise<ClarifyResumePayload>((resolve, reject) => {
    const timer = setTimeout(() => {
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

/** Test helper */
export function clearClarifyWaiters(): void {
  for (const [runId, waiter] of waiters()) {
    waiter.settled = true;
    clearTimeout(waiter.timer);
    clearInterval(waiter.poll);
    removePending(runId);
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
