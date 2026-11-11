import { ipcMain, webContents, type WebContents } from "electron";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import yaml from "js-yaml";
import { getAgxHomeDir } from "./agx-home";
import { startNmSocketServer, type NmSocketServer } from "./nm-socket-server";

function agxConfigDir(): string {
  return getAgxHomeDir();
}

const PORT_FILE = () => path.join(agxConfigDir(), "browser_bridge.port");
const TOKEN_FILE = () => path.join(agxConfigDir(), "browser_bridge.token");
const DESKTOP_USE_DIR = () => path.join(agxConfigDir(), "desktop-use");

const ACTIONS = new Set([
  "open",
  "snapshot",
  "click",
  "type",
  "press_key",
  "extract_text",
  "screenshot",
]);

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

let server: http.Server | null = null;
let token = "";
const pending = new Map<string, Pending>();

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address() as net.AddressInfo | null;
      const port = address?.port;
      srv.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!port) {
          reject(new Error("no free port"));
          return;
        }
        resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

function isLoopback(addr: string | undefined): boolean {
  const raw = String(addr || "").trim().toLowerCase();
  return raw === "127.0.0.1" || raw === "::1" || raw === ":ffff:127.0.0.1";
}

function writeSecretFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* windows */
  }
}

function removeBridgeFiles(): void {
  for (const filePath of [PORT_FILE(), TOKEN_FILE()]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* missing is fine */
    }
  }
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("body must be a JSON object"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function timeoutMsFor(action: string): number {
  return action === "screenshot" || action === "open" ? 30_000 : 20_000;
}

function settle(requestId: string, value: Record<string, unknown>): void {
  const item = pending.get(requestId);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(requestId);
  item.resolve(value);
}

// ---------------------------------------------------------------------------
// SP4 · Safety-layer audit — extension-backend action log.
//
// Every extension-backend act settles with source:"extension" + tab_url
// (stamped by the extension SW, defaulted again on the NM-forwarding path
// below), and is appended to the EXISTING audit outbox
// (~/.agenticx/action_audit/outbox.jsonl) in the v:1 shape the
// action-audit-uploader / Python runtime emit — no new audit file or channel.
// Lines carry the plan-mandated source:"extension" and tab_url extras, which
// the uploader passes through verbatim. Emitting is gated exactly like the
// Python audit_enabled(): the desktop must be signed into an enterprise.
// ---------------------------------------------------------------------------

/** Mirror of the Python audit_enabled() gate (enabled + non-empty token). */
function browserActionAuditEnabled(): boolean {
  try {
    const raw = fs.readFileSync(path.join(agxConfigDir(), "config.yaml"), "utf8");
    const cfg = (yaml.load(raw) ?? {}) as
      | { enterprise?: { enabled?: unknown; token?: unknown } }
      | null;
    const enterprise = cfg?.enterprise;
    return (
      enterprise?.enabled === true &&
      typeof enterprise.token === "string" &&
      enterprise.token.trim().length > 0
    );
  } catch {
    return false;
  }
}

function auditOutcomeFor(result: Record<string, unknown>): string {
  if (result.blocked === true) return "blocked";
  if (result.ok !== true) {
    if (result.error === "timeout") return "timeout";
    if (result.error === "user_declined") return "declined";
    return "error";
  }
  if (result.confirmed === true) return "confirmed";
  return "completed";
}

/** sha256 hex over the act arguments (same digest role as the Python side). */
function auditArgsDigest(action: string, body: Record<string, unknown>): string {
  const parts = [action, body.url, body.index, body.text, body.key, body.query, body.submit]
    .map((value) => `${typeof value}:${String(value ?? "")}`)
    .join("|");
  return crypto.createHash("sha256").update(parts).digest("hex");
}

/** Append one audit line; never throws into the bridge path. */
function emitBrowserActionAudit(
  sessionId: string,
  action: string,
  body: Record<string, unknown>,
  result: Record<string, unknown>,
): void {
  if (!browserActionAuditEnabled()) return;
  try {
    const dir = path.join(agxConfigDir(), "action_audit");
    fs.mkdirSync(dir, { recursive: true });
    const tabUrl = String(result.tab_url ?? result.url ?? "");
    const outcome = auditOutcomeFor(result);
    const risky = outcome === "blocked" || outcome === "declined" || outcome === "confirmed";
    const line = {
      v: 1,
      event_id: crypto.randomUUID(),
      ts: new Date().toISOString().slice(0, 19).concat("Z"),
      kind: "browser_action",
      session_id: sessionId,
      agent_id: "",
      tool_name: `near_browser_${action}`,
      subject: tabUrl,
      outcome,
      decision_source: "extension",
      risk: risky ? "high" : "low",
      args_digest: auditArgsDigest(action, body),
      summary: `near_browser_${action} → ${outcome}${tabUrl ? ` (${tabUrl})` : ""}`,
      source: "extension",
      tab_url: tabUrl,
    };
    fs.appendFileSync(path.join(dir, "outbox.jsonl"), `${JSON.stringify(line)}\n`);
  } catch (err) {
    console.warn(`[near-browser-bridge] action audit emit failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// SP5 · Page-inject dispatch — the ONE new desktop entry for
// {type:"inject_context"} rows arriving from the extension over NM.
//
// Reuses the EXISTING studio context-injection entry verbatim (the same
// POST /api/chat + context_files channel the desktop composer, the IM
// gateway and automation tasks use — see .cursor/plans/2026-03-08-studio-
// context-injection.plan.md): the page text lands in session.context_files
// keyed by the plan-mandated source annotation, and the turn placeholder
// records the injection in chat history with the kind label. No new studio
// API, no new audit channel, nothing agent-side.
// ---------------------------------------------------------------------------

/** Plan-mandated inject block format: `[来自页面 <title>](<url>)`. */
export function formatInjectSourceKey(title: string, url: string): string {
  return `[来自页面 ${String(title || "").trim() || "(无标题)"}](${String(url || "").trim()})`;
}

export type InjectContextResult = {
  ok: boolean;
  session_id?: string;
  error?: string;
};

type StudioSessionRow = { session_id?: unknown; updated_at?: unknown; name?: unknown };

/** Inject payload sanity: kind must be one of the two menu items. */
function validInjectKind(kind: unknown): kind is "selection" | "page" {
  return kind === "selection" || kind === "page";
}

/**
 * Locate the target Studio session: the extension's cached active session
 * when present, else the most recently active session from GET /api/sessions
 * (list_sessions sorts pinned-first; re-sort by updated_at so a pinned but
 * stale session never shadows the live one — the P1 "最近活跃" rule).
 */
async function resolveInjectSessionId(
  payloadSessionId: string,
  studio: InjectContextStudio,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<{ sessionId?: string; error?: string }> {
  if (payloadSessionId) {
    return { sessionId: payloadSessionId };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${studio.url().replace(/\/+$/, "")}/api/sessions`, {
      headers: { "x-agx-desktop-token": studio.token() },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { error: `studio_sessions_${res.status}` };
    }
    const body = (await res.json()) as { sessions?: unknown };
    const rows = Array.isArray(body?.sessions) ? (body.sessions as StudioSessionRow[]) : [];
    const latest = rows
      .filter((row) => String(row?.session_id ?? "").trim())
      .sort((a, b) => Number(b?.updated_at ?? 0) - Number(a?.updated_at ?? 0))[0];
    if (!latest) {
      return { error: "no_active_session" };
    }
    return { sessionId: String(latest.session_id).trim() };
  } catch {
    return { error: "studio_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SP5 dispatch (the single inject_context entry on the desktop side):
 * locate the session → POST /api/chat with the annotated context block.
 * The SSE body is abandoned after the first chunk (user row + context_files
 * merge happen server-side before streaming; keep_runtime_after_disconnect
 * keeps the turn running so the Studio UI still shows the reply).
 */
export async function dispatchInjectContext(
  payload: Record<string, unknown>,
  studio: InjectContextStudio | undefined,
): Promise<InjectContextResult> {
  if (!studio) {
    return { ok: false, error: "inject_not_configured" };
  }
  const kind = payload.kind;
  const url = String(payload.url ?? "").trim();
  const title = String(payload.title ?? "").trim();
  const text = String(payload.text ?? "").trim();
  if (!validInjectKind(kind) || !url || !text) {
    return { ok: false, error: "invalid_inject_payload" };
  }
  const fetchFn = studio.fetchFn ?? fetch;
  const payloadSessionId = String(payload.session_id ?? "").trim();
  const resolved = await resolveInjectSessionId(payloadSessionId, studio, fetchFn, 5_000);
  if (resolved.error || !resolved.sessionId) {
    return { ok: false, error: resolved.error ?? "no_active_session" };
  }
  const sessionId = resolved.sessionId;
  const kindLabel = kind === "selection" ? "划词" : "整页";
  const sourceKey = formatInjectSourceKey(title, url);
  const truncatedNote = payload.truncated === true ? "（超长已裁剪）" : "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetchFn(`${studio.url().replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agx-desktop-token": studio.token(),
      },
      signal: controller.signal,
      body: JSON.stringify({
        session_id: sessionId,
        // Gateway precedent (gateway/client.py L1105): a placeholder user
        // turn for attachment-only messages — /api/chat requires ≥1 char and
        // this row is what surfaces the injection in the session history.
        user_input: `[浏览器注入] 已注入${kindLabel}页面上下文${truncatedNote}：${sourceKey}`,
        // Existing context-injection mechanism: key = source annotation
        // (plan §1.3 format), value = page text; merged into
        // session.context_files and rendered by _build_context_files_block.
        context_files: { [sourceKey]: text },
        keep_runtime_after_disconnect: true,
      }),
    });
    if (res.status === 404) {
      return { ok: false, session_id: sessionId, error: "session_not_found" };
    }
    if (!res.ok) {
      return { ok: false, session_id: sessionId, error: `studio_chat_${res.status}` };
    }
    // Wait for the first SSE chunk: proves the server accepted the turn and
    // merged the context before we drop the stream.
    const reader = res.body?.getReader();
    if (reader) {
      await reader.read();
      await reader.cancel().catch(() => {
        /* server already closed */
      });
    }
    return { ok: true, session_id: sessionId };
  } catch {
    return { ok: false, session_id: sessionId, error: "studio_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** SP5: push the latest active session to the extension so it can cache the
 *  target for the next inject (plan §1.2 "最近一次激活 session"). */
function pushActiveSession(
  nmChannel: NmChannel,
  row: { session_id: string; name?: string },
): void {
  nmChannel.sendAct({
    type: "active_session",
    session_id: row.session_id,
    name: row.name ?? "",
    ts: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// SP2 · ExtensionBackend — dual-backend routing (embedded IPC vs extension NM).
// The agent-side contract (~/.agenticx/browser_bridge.port|token + POST
// /v1/browser/act + pending/settle by request_id) is reused verbatim; only the
// execution leg changes per backend.
// ---------------------------------------------------------------------------

/** Backend selection: embedded (Electron webContents IPC) / extension (NM) / auto (heartbeat). */
export type BrowserBackendMode = "embedded" | "extension" | "auto";

/**
 * NM-side channel surface the bridge routes through.
 * Structural superset matches NmSocketServer, so tests can inject a mock or a
 * real socket server interchangeably.
 */
export type NmChannel = {
  extensionOnline(): boolean;
  sendAct(message: Record<string, unknown>): boolean;
  onActResult(handler: ((row: Record<string, unknown>) => void) | null): void;
  /** SP5: optional so pre-SP5 test mocks keep compiling; the real NM socket
   *  server always provides it. */
  onInjectContext?(handler: ((row: Record<string, unknown>) => void) | null): void;
};

/**
 * SP5 · page-inject studio target — the ONLY studio knowledge the bridge
 * needs to route inject_context rows into the existing context-injection
 * entry (POST /api/chat with context_files). main.ts supplies getters so a
 * redirected AGX connection is honored per request.
 */
export type InjectContextStudio = {
  url(): string;
  token(): string;
  /** Test injection; defaults to global fetch. */
  fetchFn?: typeof fetch;
};

export type StartNearBrowserBridgeOptions = {
  /** Test injection; default lazily starts the real NM socket server. */
  nmChannel?: NmChannel;
  /** Test injection; defaults to timeoutMsFor. */
  timeoutMs?: (action: string) => number;
  /** SP5: inject_context dispatch target. Without it the bridge still
   *  transports the rows but every inject fails with inject_not_configured. */
  injectContextStudio?: InjectContextStudio;
};

const BACKEND_MODES = new Set<string>(["embedded", "extension", "auto"]);

/** Read per request so env flips (tests, e2e) apply without a restart. */
function backendModeFromEnv(): BrowserBackendMode {
  const raw = String(process.env.AGX_BROWSER_BACKEND ?? "").trim().toLowerCase();
  return BACKEND_MODES.has(raw) ? (raw as BrowserBackendMode) : "auto";
}

/**
 * SP3 stub compatibility: AGX_EXT_STUB=1 pins the extension to the SP2 stub
 * executor (forwarded as stub:true on the act message) so the SP2 acceptance
 * run stays green next to the real executor. Read per request like the
 * backend mode.
 */
function stubModeFromEnv(): boolean {
  return String(process.env.AGX_EXT_STUB ?? "").trim() === "1";
}

type NmLifecycle = {
  channel: NmChannel;
  start(): Promise<void>;
  stop(): Promise<void>;
};

let nmLifecycle: NmLifecycle | null = null;

/**
 * Default NM channel: starts the real unix-socket server next to the HTTP
 * bridge. A bind failure (e.g. a leftover SP1 spike server holding the socket)
 * must NOT take the bridge down — it leaves the extension backend offline and
 * auto mode falls back to embedded.
 */
function createDefaultNmLifecycle(): NmLifecycle {
  let started: NmSocketServer | null = null;
  let startPromise: Promise<void> | null = null;
  let actResultHandler: ((row: Record<string, unknown>) => void) | null = null;
  let injectContextHandler: ((row: Record<string, unknown>) => void) | null = null;
  return {
    channel: {
      extensionOnline: () => started?.extensionOnline() ?? false,
      sendAct: (message) => started?.sendAct(message) ?? false,
      onActResult: (handler) => {
        actResultHandler = handler;
      },
      onInjectContext: (handler) => {
        injectContextHandler = handler;
      },
    },
    start: () => {
      startPromise ??= startNmSocketServer()
        .then((server) => {
          started = server;
          server.onActResult((row) => actResultHandler?.(row));
          server.onInjectContext((row) => injectContextHandler?.(row));
        })
        .catch((err: unknown) => {
          console.warn(
            "[near-browser-bridge] NM socket unavailable; extension backend stays offline:",
            err instanceof Error ? err.message : String(err),
          );
          startPromise = null;
        });
      return startPromise;
    },
    stop: async () => {
      const server = started;
      started = null;
      await server?.close();
    },
  };
}

/** Route an act request: explicit extension, or auto with a live heartbeat. */
function routesToExtension(mode: BrowserBackendMode, channel: NmChannel): boolean {
  if (mode === "extension") return true;
  if (mode === "auto") return channel.extensionOnline();
  return false;
}

export function startNearBrowserBridge(
  getHost: () => WebContents | null,
  options?: StartNearBrowserBridgeOptions,
): void {
  if (server) return;

  const timeoutOf: (action: string) => number = options?.timeoutMs ?? timeoutMsFor;
  if (options?.nmChannel) {
    nmLifecycle = {
      channel: options.nmChannel,
      start: async () => {},
      stop: async () => {},
    };
  } else {
    nmLifecycle ??= createDefaultNmLifecycle();
  }
  const lifecycle = nmLifecycle;
  const nmChannel = lifecycle.channel;

  // Extension backend replies arrive from the NM channel; settle reuses the
  // exact same pending map as the embedded IPC path. SP4: guarantee the
  // audit fields even if an older SW build forgot to stamp them.
  nmChannel.onActResult((row) => {
    const requestId = String(row.request_id || "").trim();
    if (!requestId) return;
    if (row.source !== "extension") {
      row.source = "extension";
    }
    if (!row.tab_url) {
      row.tab_url = String(row.url ?? "");
    }
    settle(requestId, row);
  });

  // SP5 · page-inject: one dispatch per inject_context row; the outcome goes
  // back as {type:"inject_context_result"} so the extension can surface
  // "AGX 未运行" instead of dropping the send silently. A successful inject
  // also pushes {type:"active_session"} so the extension caches the target.
  nmChannel.onInjectContext?.((row) => {
    void (async () => {
      const result = await dispatchInjectContext(row, options?.injectContextStudio);
      try {
        nmChannel.sendAct({
          type: "inject_context_result",
          request_id: String(row.request_id ?? ""),
          ...result,
        });
        if (result.ok && result.session_id) {
          pushActiveSession(nmChannel, { session_id: result.session_id });
        }
      } catch {
        /* peer gone; the extension's own NM-down path covers this */
      }
    })();
  });

  ipcMain.handle("near-browser-act-result", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "invalid_result" };
    }
    const row = payload as Record<string, unknown>;
    const requestId = String(row.request_id || "").trim();
    if (!requestId) return { ok: false, error: "missing_request_id" };
    settle(requestId, row);
    return { ok: true };
  });

  ipcMain.handle("extract-near-browser-frames", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "invalid payload" };
    }
    const row = payload as { webContentsId?: unknown; query?: unknown };
    const id = Number(row.webContentsId);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "missing_web_contents_id" };
    }
    const wc = webContents.fromId(id);
    if (!wc || wc.isDestroyed()) {
      return { ok: false, error: "guest_not_ready" };
    }
    const query = String(row.query || "").trim().toLowerCase();
    const frameScript = `(() => {
      const collect = (root) => {
        if (!root) return "";
        const chunks = [];
        const direct = root.innerText || root.textContent || "";
        if (direct) chunks.push(direct);
        const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const el of nodes) {
          if (el.shadowRoot) chunks.push(collect(el.shadowRoot));
        }
        return chunks.join("\\n");
      };
      const raw = collect(document.body || document.documentElement);
      return String(raw || "").split(/\\n+/).map((line) => line.replace(/[ \\t]+/g, " ").trim()).filter(Boolean).join("\\n");
    })()`;
    const parts: string[] = [];
    const frames = wc.mainFrame?.framesInSubtree ?? [wc.mainFrame];
    for (const frame of frames) {
      if (!frame) continue;
      try {
        const raw = await frame.executeJavaScript(frameScript, false);
        const text = String(raw || "").trim();
        if (text) parts.push(text);
      } catch {
        /* frame not ready / destroyed */
      }
    }
    let text = parts.join("\n");
    if (query) {
      const hits = text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.toLowerCase().includes(query))
        .slice(0, 80);
      if (hits.length) text = hits.join("\n");
    }
    return { ok: true, text: text.slice(0, 24000), frame_count: parts.length };
  });

  ipcMain.handle("save-near-browser-screenshot", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "invalid payload" };
    }
    const dataUrl = String((payload as { dataUrl?: unknown }).dataUrl || "").trim();
    const matched = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!matched?.[1]) return { ok: false, error: "invalid_png" };
    try {
      fs.mkdirSync(DESKTOP_USE_DIR(), { recursive: true });
      const filePath = path.join(DESKTOP_USE_DIR(), `browser_${Date.now()}.png`);
      fs.writeFileSync(filePath, Buffer.from(matched[1], "base64"));
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const requestListener = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    if (!isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: "loopback_only" });
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const auth = String(req.headers.authorization || "");

    if (req.method === "GET" && url.pathname === "/v1/browser/status") {
      if (auth !== `Bearer ${token}`) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        backend: backendModeFromEnv(),
        extension_online: nmChannel.extensionOnline(),
      });
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/v1/browser/act") {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    if (auth !== `Bearer ${token}`) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    const action = String(body.action || "").trim();
    const sessionId = String(body.session_id || "").trim();
    if (!ACTIONS.has(action) || !sessionId) {
      sendJson(res, 400, { ok: false, error: "invalid_action_or_session" });
      return;
    }

    if (routesToExtension(backendModeFromEnv(), nmChannel)) {
      // Extension backend (SP2): forward over the NM socket; the extension's
      // act_result settles the SAME pending entry by request_id. Error shape
      // matches the embedded leg so the agent-side consumer is unchanged.
      const requestId = crypto.randomUUID();
      const message = {
        type: "act",
        request_id: requestId,
        session_id: sessionId,
        action,
        url: body.url,
        index: body.index,
        text: body.text,
        key: body.key,
        submit: body.submit,
        query: body.query,
        stub: stubModeFromEnv(),
      };
      const result = await new Promise<Record<string, unknown>>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          resolve({
            ok: false,
            request_id: requestId,
            source: "extension",
            error: "timeout",
            hint: "浏览器扩展未在时限内回报，请确认扩展已连接。",
          });
        }, timeoutOf(action));
        pending.set(requestId, { resolve, timer });
        if (!nmChannel.sendAct(message)) {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve({
            ok: false,
            request_id: requestId,
            source: "extension",
            error: "extension_offline",
            hint: "浏览器扩展通道当前不可用，请确认扩展已连接后重试。",
          });
        }
      });
      // SP4: safety-layer audit — same outbox the action-audit-uploader drains
      // (blocked / confirmed / declined / completed / timeout all recorded).
      emitBrowserActionAudit(sessionId, action, body, result);
      sendJson(res, 200, result);
      return;
    }

    const host = getHost();
    if (!host || host.isDestroyed()) {
      sendJson(res, 200, { ok: false, error: "desktop_window_unavailable" });
      return;
    }

    const requestId = crypto.randomUUID();
    const message = {
      request_id: requestId,
      session_id: sessionId,
      action,
      url: body.url,
      index: body.index,
      text: body.text,
      key: body.key,
      submit: body.submit,
      query: body.query,
    };

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({
          ok: false,
          request_id: requestId,
          error: "timeout",
          hint: "WorkPanel 浏览器未在时限内回报，请确认右侧浏览器 tab 已打开。",
        });
      }, timeoutOf(action));
      pending.set(requestId, { resolve, timer });
      try {
        host.send("near-browser-act", message);
      } catch (err) {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve({
          ok: false,
          request_id: requestId,
          error: "ipc_send_failed",
          hint: err instanceof Error ? err.message : String(err),
        });
      }
    });
    sendJson(res, 200, result);
  };

  void (async () => {
    try {
      // NM first so extension_online is meaningful by the time the HTTP
      // bridge answers; a bind failure inside start() just leaves the
      // extension backend offline (auto falls back to embedded).
      await lifecycle.start();
      // SP5: best-effort startup push of the latest active session (the
      // studio server may not be up yet during desktop boot — every later
      // successful inject re-pushes, so a silent miss here self-heals).
      const studio = options?.injectContextStudio;
      if (studio) {
        void (async () => {
          const resolved = await resolveInjectSessionId(
            "",
            studio,
            studio.fetchFn ?? fetch,
            3_000,
          );
          if (resolved.sessionId) {
            pushActiveSession(nmChannel, { session_id: resolved.sessionId });
          }
        })().catch(() => {
          /* probe only */
        });
      }
      const port = await findFreePort();
      token = crypto.randomUUID();
      const created = http.createServer((req, res) => {
        void requestListener(req, res);
      });
      created.listen(port, "127.0.0.1", () => {
        writeSecretFile(PORT_FILE(), String(port));
        writeSecretFile(TOKEN_FILE(), token);
        server = created;
      });
      created.on("error", (err) => {
        console.error("[near-browser-bridge]", err);
      });
    } catch (err) {
      console.error("[near-browser-bridge] start failed", err);
    }
  })();
}

export function stopNearBrowserBridge(): void {
  for (const [requestId, item] of pending) {
    clearTimeout(item.timer);
    item.resolve({ ok: false, request_id: requestId, error: "bridge_stopped" });
  }
  pending.clear();
  try {
    ipcMain.removeHandler("near-browser-act-result");
  } catch {
    /* already gone */
  }
  try {
    ipcMain.removeHandler("extract-near-browser-frames");
  } catch {
    /* already gone */
  }
  try {
    ipcMain.removeHandler("save-near-browser-screenshot");
  } catch {
    /* already gone */
  }
  if (server) {
    try {
      server.close();
    } catch {
      /* noop */
    }
    server = null;
  }
  token = "";
  removeBridgeFiles();
  const lifecycle = nmLifecycle;
  nmLifecycle = null;
  if (lifecycle) {
    void lifecycle.stop();
  }
}
