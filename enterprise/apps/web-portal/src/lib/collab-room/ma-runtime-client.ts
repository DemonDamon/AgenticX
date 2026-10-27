import { readFileSync } from "node:fs";
import { log } from "../observability/logger";

export const MA_ON_BEHALF_OF_HEADER = "X-AgenticX-On-Behalf-Of";
export const DEFAULT_MA_RUNTIME_URL = "http://127.0.0.1:8092";
export const DEFAULT_REPLY_TIMEOUT_MS = 180_000;
const MIN_REPLY_TIMEOUT_MS = 5_000;
const MAX_REPLY_TIMEOUT_MS = 1_800_000;
const SERVICE_TOKEN_PREFIX = "agx-pat-";

export type MaRuntimeConfig = { baseUrl: string; serviceToken: string; replyTimeoutMs: number };

/** 托管运行时返回的 wire 事件（MA-00 ServerEvent / ClientEvent 的 JSON 形状，至少含 id/seq/type/created_at）。 */
export type MaWireEvent = { id: string; seq: number; type: string; created_at?: string } & Record<string, unknown>;

export type SseFrame = { id: string | null; event: string; data: string };

export class MaRuntimeError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "MaRuntimeError";
    this.status = status;
    this.code = code;
  }
}

let configWarningEmitted = false;

/** 测试隔离：配置不完整告警每个进程只打一次。 */
export function __resetMaRuntimeConfigWarningForTests(): void {
  configWarningEmitted = false;
}

function warnInvalidConfig(reason: string): void {
  if (configWarningEmitted) return;
  configWarningEmitted = true;
  log("warn", { event: "room.agent_reply.ma_config_invalid", reason });
}

type MaEnv = Record<string, string | undefined>;

function readServiceToken(env: MaEnv): string {
  const filePath = env.MA_RUNTIME_SERVICE_TOKEN_FILE?.trim();
  if (filePath) {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch {
      return "";
    }
  }
  return env.MA_RUNTIME_SERVICE_TOKEN?.trim() ?? "";
}

function runtimeBaseUrl(env: MaEnv): string {
  const raw = env.MA_RUNTIME_URL?.trim();
  const value = raw ? raw : DEFAULT_MA_RUNTIME_URL;
  return value.replace(/\/+$/, "");
}

function runtimeReplyTimeout(env: MaEnv): number {
  const raw = env.MA_RUNTIME_REPLY_TIMEOUT_MS?.trim();
  if (!raw || !/^-?\d+$/.test(raw)) return DEFAULT_REPLY_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return DEFAULT_REPLY_TIMEOUT_MS;
  return Math.min(MAX_REPLY_TIMEOUT_MS, Math.max(MIN_REPLY_TIMEOUT_MS, parsed));
}

/** 读取门户进程的托管运行时配置；未启用或 token 不合法时返回 null。 */
export function resolveMaRuntimeConfig(env: MaEnv = process.env): MaRuntimeConfig | null {
  if (env.MA_RUNTIME_ENABLED?.trim() !== "1") return null;
  const serviceToken = readServiceToken(env);
  if (!serviceToken.startsWith(SERVICE_TOKEN_PREFIX)) {
    warnInvalidConfig(serviceToken ? "invalid_service_token" : "missing_service_token");
    return null;
  }
  return {
    baseUrl: runtimeBaseUrl(env),
    serviceToken,
    replyTimeoutMs: runtimeReplyTimeout(env),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException("This operation was aborted", "AbortError");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function maFetch(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new MaRuntimeError(String(error), 0, null);
  }
}

async function throwForStatus(res: Response): Promise<never> {
  let code: string | null = null;
  let message = "";
  try {
    const body = (await res.json()) as unknown;
    const error = asRecord(asRecord(body)?.error);
    if (typeof error?.code === "string") code = error.code;
    if (typeof error?.message === "string") message = error.message;
  } catch (error) {
    if (isAbortError(error)) throw error;
  }
  throw new MaRuntimeError(message || `agent runtime status ${res.status}`, res.status, code);
}

async function readJson(res: Response, invalidMessage: string): Promise<unknown> {
  try {
    return await res.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new MaRuntimeError(invalidMessage, res.status, null);
  }
}

function authHeader(serviceToken: string): Record<string, string> {
  return { authorization: `Bearer ${serviceToken}` };
}

function toWireEvent(value: unknown): MaWireEvent | null {
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.seq !== "number" || !Number.isFinite(record.seq) || typeof record.type !== "string") return null;
  return {
    ...record,
    id: typeof record.id === "string" ? record.id : "",
    seq: record.seq,
    type: record.type,
  };
}

export async function createMaSession(
  config: MaRuntimeConfig,
  input: { agentId: string; onBehalfOf: string; title: string },
  fetchImpl: typeof fetch,
): Promise<{ id: string; agentVersion: number }> {
  const res = await maFetch(
    `${config.baseUrl}/ma/v1/sessions`,
    {
      method: "POST",
      headers: {
        ...authHeader(config.serviceToken),
        "content-type": "application/json",
        [MA_ON_BEHALF_OF_HEADER]: input.onBehalfOf,
      },
      body: JSON.stringify({
        agent_id: input.agentId,
        source: "portal",
        title: input.title,
      }),
    },
    fetchImpl,
  );
  if (!res.ok) await throwForStatus(res);
  const body = asRecord(await readJson(res, "invalid session response"));
  const id = body?.id;
  const agentVersion = body?.agent_version;
  if (typeof id !== "string" || id.length !== 26 || typeof agentVersion !== "number" || !Number.isInteger(agentVersion) || agentVersion < 1) {
    throw new MaRuntimeError("invalid session response", res.status, null);
  }
  return { id, agentVersion };
}

export async function postMaEvents(
  config: MaRuntimeConfig,
  sessionId: string,
  events: Array<Record<string, unknown>>,
  fetchImpl: typeof fetch,
): Promise<MaWireEvent[]> {
  const res = await maFetch(
    `${config.baseUrl}/ma/v1/sessions/${encodeURIComponent(sessionId)}/events`,
    {
      method: "POST",
      headers: {
        ...authHeader(config.serviceToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ events }),
    },
    fetchImpl,
  );
  if (!res.ok) await throwForStatus(res);
  const body = asRecord(await readJson(res, "invalid events response"));
  const rawEvents = body?.events;
  if (!Array.isArray(rawEvents)) throw new MaRuntimeError("invalid events response", res.status, null);
  const wires: MaWireEvent[] = [];
  for (const item of rawEvents) {
    const wire = toWireEvent(item);
    if (!wire) throw new MaRuntimeError("invalid events response", res.status, null);
    wires.push(wire);
  }
  return wires;
}

function readOrAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => {
      finish(() => reject(abortError(signal)));
      void reader.cancel(abortError(signal)).catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
  });
}

function bindAbort(body: ReadableStream<Uint8Array>, signal: AbortSignal): ReadableStream<Uint8Array> {
  if (signal.aborted) {
    const reason = abortError(signal);
    return new ReadableStream({
      start(controller) {
        controller.error(reason);
      },
    });
  }
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await readOrAbort(reader, signal);
        if (signal.aborted) {
          controller.error(abortError(signal));
          return;
        }
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(next.value);
      } catch (error) {
        const reason = error instanceof Error ? error : new Error(String(error));
        try {
          controller.error(reason);
        } catch {
          // The stream is already errored or closed.
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** 逐条产出 SSE 数据帧解析出的 wire 事件；ping 与无 data 的帧不产出。signal 触发时抛 AbortError。 */
export async function* streamMaEvents(
  config: MaRuntimeConfig,
  sessionId: string,
  opts: { afterSeq: number; signal: AbortSignal },
  fetchImpl: typeof fetch,
): AsyncGenerator<MaWireEvent> {
  const url = new URL(`${config.baseUrl}/ma/v1/sessions/${encodeURIComponent(sessionId)}/events/stream`);
  url.searchParams.set("after_seq", String(opts.afterSeq));
  const res = await maFetch(
    url.toString(),
    {
      method: "GET",
      headers: {
        ...authHeader(config.serviceToken),
        accept: "text/event-stream",
      },
      signal: opts.signal,
    },
    fetchImpl,
  );
  if (!res.ok) await throwForStatus(res);
  if (!res.body) throw new MaRuntimeError("empty stream", res.status, null);
  for await (const frame of parseSseStream(bindAbort(res.body, opts.signal))) {
    if (opts.signal.aborted) throw abortError(opts.signal);
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      continue;
    }
    const wire = toWireEvent(parsed);
    if (wire) yield wire;
  }
  if (opts.signal.aborted) throw abortError(opts.signal);
}

/**
 * 把字节流解析成 SSE 帧。空行才分发；`:` 开头的注释行忽略；
 * 多行 data 用换行接起来；event 缺省为 message。
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let messageId: string | null = null;
  let sawData = false;

  const reset = (): void => {
    eventName = "message";
    dataLines = [];
    messageId = null;
    sawData = false;
  };

  const consumeLine = (raw: string): SseFrame | null => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") {
      if (!sawData) {
        reset();
        return null;
      }
      const frame: SseFrame = { id: messageId, event: eventName, data: dataLines.join("\n") };
      reset();
      return frame;
    }
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    const name = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (name === "id") messageId = value;
    else if (name === "event") eventName = value || "message";
    else if (name === "data") {
      dataLines.push(value);
      sawData = true;
    }
    return null;
  };

  const drain = function* (flushTail: boolean): Generator<SseFrame> {
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const frame = consumeLine(raw);
      if (frame) yield frame;
      newline = buffer.indexOf("\n");
    }
    if (flushTail && buffer.length > 0) {
      const frame = consumeLine(buffer);
      buffer = "";
      if (frame) yield frame;
    }
  };

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        buffer += decoder.decode();
        yield* drain(true);
        return;
      }
      if (next.value) buffer += decoder.decode(next.value, { stream: true });
      yield* drain(false);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The caller may already have cancelled this reader.
    }
  }
}

export const DEFAULT_DESKTOP_REPLY_TIMEOUT_MS = 600_000;
export const DEFAULT_DESKTOP_CLAIM_NOTICE_MS = 15_000;
const MIN_DESKTOP_CLAIM_NOTICE_MS = 1_000;
const MAX_DESKTOP_CLAIM_NOTICE_MS = 120_000;

export type MaDesktopRoutingConfig = { replyTimeoutMs: number; claimNoticeMs: number };

function clampDesktopMillis(raw: string | undefined, fallback: number, min: number, max: number): number {
  const trimmed = raw?.trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed)) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 桌面切换开关。base 为 resolveMaRuntimeConfig 的结果；base 为 null 或开关不为 "1" 时返回 null（不告警）。 */
export function resolveMaDesktopRoutingConfig(
  base: MaRuntimeConfig | null,
  env: MaEnv = process.env,
): MaDesktopRoutingConfig | null {
  if (!base || env.MA_RUNTIME_DESKTOP_ROUTING?.trim() !== "1") return null;
  return {
    replyTimeoutMs: clampDesktopMillis(
      env.MA_RUNTIME_DESKTOP_REPLY_TIMEOUT_MS,
      DEFAULT_DESKTOP_REPLY_TIMEOUT_MS,
      MIN_REPLY_TIMEOUT_MS,
      MAX_REPLY_TIMEOUT_MS,
    ),
    claimNoticeMs: clampDesktopMillis(
      env.MA_RUNTIME_DESKTOP_CLAIM_NOTICE_MS,
      DEFAULT_DESKTOP_CLAIM_NOTICE_MS,
      MIN_DESKTOP_CLAIM_NOTICE_MS,
      MAX_DESKTOP_CLAIM_NOTICE_MS,
    ),
  };
}

/** POST /ma/v1/sessions/:id/archive。非 2xx 抛 MaRuntimeError（同 postMaEvents 的错误映射）。 */
export async function archiveMaSession(
  config: MaRuntimeConfig,
  sessionId: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const res = await maFetch(
    `${config.baseUrl}/ma/v1/sessions/${encodeURIComponent(sessionId)}/archive`,
    { method: "POST", headers: authHeader(config.serviceToken) },
    fetchImpl,
  );
  if (!res.ok) await throwForStatus(res);
}
