import { proxyAwareFetch } from "./proxy-fetch";
import { parseSseChunk } from "./ma-sse";

export type MaEndpoint = { baseUrl: string; token: string };
export type MaFetch = typeof proxyAwareFetch;
const MA_ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const MA_STREAM_BACKOFF_MS = [1000, 2000, 5000, 10000] as const;
export const MA_STREAM_IDLE_TIMEOUT_MS = 45_000;
export const MA_REST_TIMEOUT_MS = 30_000;

export type MaRestResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string; message: string };

export type MaStreamSink = {
  frame(payload: { streamId: string; id: number | null; event: string; data: unknown }): void;
  state(payload: { streamId: string; state: "open" | "reconnecting" | "closed" | "error"; code?: string; message?: string }): void;
};

type StreamEntry = {
  ctrl: AbortController;
  ownerId: number;
  generation: number;
};

/**
 * cfg.enterprise.enabled === true && token starts with "agx-pat-" && a base URL is present.
 * Prefer enterprise.worker.ma_base_url when it is a non-empty string. Trailing slashes are stripped.
 */
export function resolveMaEndpoint(cfg: unknown): MaEndpoint | null {
  if (!cfg || typeof cfg !== "object") return null;
  const enterprise = (cfg as { enterprise?: unknown }).enterprise;
  if (!enterprise || typeof enterprise !== "object") return null;
  const row = enterprise as {
    enabled?: unknown;
    token?: unknown;
    base_url?: unknown;
    worker?: unknown;
  };
  if (row.enabled !== true) return null;
  const token = typeof row.token === "string" ? row.token : "";
  if (!token.startsWith("agx-pat-")) return null;
  const worker = row.worker && typeof row.worker === "object"
    ? (row.worker as { ma_base_url?: unknown }).ma_base_url
    : undefined;
  const preferred = typeof worker === "string" && worker.trim() ? worker.trim() : "";
  const fallback = typeof row.base_url === "string" ? row.base_url.trim() : "";
  const baseUrl = (preferred || fallback).replace(/\/+$/, "");
  if (!baseUrl) return null;
  return { baseUrl, token };
}

export function buildCreateSessionBody(payload?: {
  agentId?: string;
  environmentId?: string;
  title?: string;
} | null):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 400; code: "invalid_request"; message: string } {
  const agentId = String(payload?.agentId ?? "");
  if (!MA_ULID_RE.test(agentId)) {
    return { ok: false, status: 400, code: "invalid_request", message: "invalid agent id" };
  }
  const env = payload?.environmentId ? String(payload.environmentId) : "";
  if (env && !MA_ULID_RE.test(env)) {
    return { ok: false, status: 400, code: "invalid_request", message: "invalid environment id" };
  }
  const body: Record<string, unknown> = { agent_id: agentId, source: "desktop" };
  const title = String(payload?.title ?? "").trim().slice(0, 200);
  if (title) body.title = title;
  if (env) body.environment_id = env;
  return { ok: true, body };
}

export async function maRequest<T>(
  endpoint: MaEndpoint,
  method: "GET" | "POST",
  path: string,
  init?: { body?: unknown; query?: Record<string, string | number | string[]> },
  fetchImpl: MaFetch = proxyAwareFetch,
): Promise<MaRestResult<T>> {
  const url = new URL(`${endpoint.baseUrl}/ma/v1${path.startsWith("/") ? path : `/${path}`}`);
  if (init?.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${endpoint.token}`,
    Accept: "application/json",
  };
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const resp = await fetchImpl(url.toString(), {
      method,
      headers,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(MA_REST_TIMEOUT_MS),
    });
    if (resp.ok) {
      try {
        const data = (await resp.json()) as T;
        return { ok: true, status: resp.status, data };
      } catch {
        return { ok: false, status: resp.status, code: `http_${resp.status}`, message: `请求失败（${resp.status}）` };
      }
    }
    const parsed = await readErrorBody(resp, resp.status);
    return { ok: false, status: resp.status, code: parsed.code, message: parsed.message };
  } catch {
    return { ok: false, status: 0, code: "network_error", message: "无法连接企业服务" };
  }
}

export class MaStreamRegistry {
  private readonly fetchImpl: MaFetch;
  private readonly sleepImpl: ((ms: number) => Promise<void>) | null;
  private readonly now: () => number;
  private readonly idleTimeoutMs: number;
  private readonly entries = new Map<string, StreamEntry>();
  private generation = 0;

  constructor(opts?: {
    fetchImpl?: MaFetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    idleTimeoutMs?: number;
  }) {
    this.fetchImpl = opts?.fetchImpl ?? proxyAwareFetch;
    this.sleepImpl = opts?.sleep ?? null;
    this.now = opts?.now ?? (() => Date.now());
    this.idleTimeoutMs = opts?.idleTimeoutMs ?? MA_STREAM_IDLE_TIMEOUT_MS;
  }

  open(
    streamId: string,
    endpoint: MaEndpoint,
    sessionId: string,
    afterSeq: number,
    sink: MaStreamSink,
    ownerId: number,
  ): void {
    this.close(streamId);
    const generation = ++this.generation;
    const ctrl = new AbortController();
    const entry: StreamEntry = { ctrl, ownerId, generation };
    this.entries.set(streamId, entry);
    void this.pump(streamId, entry, endpoint, sessionId, afterSeq, sink);
  }

  close(streamId: string): void {
    const entry = this.entries.get(streamId);
    if (!entry) return;
    this.entries.delete(streamId);
    entry.ctrl.abort();
  }

  closeOwner(ownerId: number): void {
    for (const [streamId, entry] of this.entries) {
      if (entry.ownerId === ownerId) this.close(streamId);
    }
  }

  size(): number {
    return this.entries.size;
  }

  private async pump(
    streamId: string,
    entry: StreamEntry,
    endpoint: MaEndpoint,
    sessionId: string,
    afterSeq: number,
    sink: MaStreamSink,
  ): Promise<void> {
    const ctrl = entry.ctrl;
    let lastSeq = afterSeq > 0 ? afterSeq : 0;
    let attempt = 0;
    let terminal: "error" | "closed" = "closed";
    void this.now();
    try {
      while (!ctrl.signal.aborted) {
        let gotFrame = false;
        const attemptCtrl = new AbortController();
        const onParentAbort = () => attemptCtrl.abort();
        ctrl.signal.addEventListener("abort", onParentAbort);
        let idle: ReturnType<typeof setTimeout> | undefined;
        const clearIdle = () => {
          if (idle) clearTimeout(idle);
          idle = undefined;
        };
        const armIdle = () => {
          clearIdle();
          idle = setTimeout(() => attemptCtrl.abort(), this.idleTimeoutMs);
        };
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const cancelRead = () => {
          if (!reader) return;
          void reader.cancel().catch(() => undefined);
        };
        attemptCtrl.signal.addEventListener("abort", cancelRead);
        try {
          const headers: Record<string, string> = {
            Authorization: `Bearer ${endpoint.token}`,
            Accept: "text/event-stream",
          };
          if (lastSeq > 0) headers["Last-Event-ID"] = String(lastSeq);
          const url = `${endpoint.baseUrl}/ma/v1/sessions/${encodeURIComponent(sessionId)}/events/stream?event_deltas[]=agent.message`;
          const resp = await this.fetchImpl(url, { headers, signal: attemptCtrl.signal });
          if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
            const parsed = await readErrorBody(resp, resp.status);
            sink.state({ streamId, state: "error", code: parsed.code, message: parsed.message });
            terminal = "error";
            break;
          }
          if (!resp.ok || !resp.body) throw new Error(`http_${resp.status}`);
          sink.state({ streamId, state: "open" });
          reader = resp.body.getReader();
          armIdle();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!ctrl.signal.aborted && !attemptCtrl.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            armIdle();
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSseChunk(buffer);
            buffer = parsed.rest;
            for (const message of parsed.messages) {
              let data: unknown;
              try {
                data = JSON.parse(message.data) as unknown;
              } catch {
                continue;
              }
              const id = message.id && /^\d+$/.test(message.id) ? Number(message.id) : null;
              if (id != null) lastSeq = Math.max(lastSeq, id);
              sink.frame({ streamId, id, event: message.event, data });
              gotFrame = true;
            }
          }
        } catch {
          if (ctrl.signal.aborted) break;
        } finally {
          clearIdle();
          attemptCtrl.signal.removeEventListener("abort", cancelRead);
          ctrl.signal.removeEventListener("abort", onParentAbort);
        }
        if (ctrl.signal.aborted || terminal === "error") break;
        if (gotFrame) attempt = 0;
        sink.state({ streamId, state: "reconnecting" });
        const delay = MA_STREAM_BACKOFF_MS[Math.min(attempt, MA_STREAM_BACKOFF_MS.length - 1)] ?? 10000;
        attempt += 1;
        await this.waitBackoff(delay, ctrl.signal);
      }
    } finally {
      const current = this.entries.get(streamId);
      const superseded = current != null && current.generation !== entry.generation;
      if (current?.generation === entry.generation) this.entries.delete(streamId);
      if (!superseded && terminal !== "error") sink.state({ streamId, state: "closed" });
    }
  }

  private async waitBackoff(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (this.sleepImpl) {
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<void>((resolve) => {
        onAbort = () => resolve();
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        await Promise.race([this.sleepImpl(ms), aborted]);
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, ms);
      const onAbort = () => finish();
      function finish() {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve();
      }
      if (signal.aborted) finish();
      else signal.addEventListener("abort", onAbort);
    });
  }
}

async function readErrorBody(resp: Response, status: number): Promise<{ code: string; message: string }> {
  try {
    const body: unknown = await resp.json();
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
      const code = error && typeof error.code === "string" && error.code ? error.code : `http_${status}`;
      const message = error && typeof error.message === "string" && error.message
        ? error.message
        : `请求失败（${status}）`;
      return { code, message };
    }
  } catch {
    // Non-JSON error bodies fall through to the status code.
  }
  return { code: `http_${status}`, message: `请求失败（${status}）` };
}
