import type { BrowserAgentResult } from "./browser-agent-actions";

export type BrowserAgentController = {
  open: (url: string) => Promise<BrowserAgentResult>;
  snapshot: () => Promise<BrowserAgentResult>;
  click: (index: number) => Promise<BrowserAgentResult>;
  type: (index: number, text: string, submit?: boolean) => Promise<BrowserAgentResult>;
  pressKey: (key: string) => Promise<BrowserAgentResult>;
  extractText: (query?: string) => Promise<BrowserAgentResult>;
  screenshot: () => Promise<BrowserAgentResult>;
};

type NearBrowserActPayload = {
  request_id: string;
  session_id: string;
  action: string;
  url?: unknown;
  index?: unknown;
  text?: unknown;
  key?: unknown;
  submit?: unknown;
  query?: unknown;
};

const controllers = new Map<string, BrowserAgentController>();
const openFallbacks = new Map<string, (url: string) => Promise<BrowserAgentResult>>();
const takeovers = new Set<string>();
const activityListeners = new Map<string, Set<() => void>>();
const takeoverListeners = new Map<string, Set<(on: boolean) => void>>();
const inFlight = new Map<string, number>();
let browserAgentIpcWired = false;
let controllerWaitMs = 2500;

export function registerBrowserAgentController(
  sessionId: string,
  ctrl: BrowserAgentController,
): () => void {
  const sid = sessionId.trim();
  if (!sid) return () => undefined;
  controllers.set(sid, ctrl);
  return () => {
    if (controllers.get(sid) === ctrl) controllers.delete(sid);
  };
}

/** Always-on opener so `near_browser_open` can reveal WorkPanel from a cold start. */
export function registerBrowserAgentOpenFallback(
  sessionId: string,
  open: (url: string) => Promise<BrowserAgentResult> | BrowserAgentResult,
): () => void {
  const sid = sessionId.trim();
  if (!sid) return () => undefined;
  const wrapped = async (url: string) => open(url);
  openFallbacks.set(sid, wrapped);
  return () => {
    if (openFallbacks.get(sid) === wrapped) openFallbacks.delete(sid);
  };
}

export function _setBrowserAgentControllerWaitMsForTests(ms: number): void {
  controllerWaitMs = Math.max(0, ms);
}

function waitForController(sessionId: string): Promise<BrowserAgentController | undefined> {
  const existing = controllers.get(sessionId);
  if (existing) return Promise.resolve(existing);
  if (controllerWaitMs <= 0) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const hit = controllers.get(sessionId);
      if (hit) {
        resolve(hit);
        return;
      }
      if (Date.now() - started >= controllerWaitMs) {
        resolve(undefined);
        return;
      }
      window.setTimeout(tick, 50);
    };
    window.setTimeout(tick, 50);
  });
}

export function setBrowserHumanTakeover(sessionId: string, on: boolean): void {
  const sid = sessionId.trim();
  if (!sid) return;
  if (on) takeovers.add(sid);
  else takeovers.delete(sid);
  const listeners = takeoverListeners.get(sid);
  if (listeners) {
    for (const listener of listeners) listener(on);
  }
}

export function isBrowserHumanTakeover(sessionId: string): boolean {
  return takeovers.has(sessionId.trim());
}

export function subscribeBrowserHumanTakeover(
  sessionId: string,
  listener: (on: boolean) => void,
): () => void {
  const sid = sessionId.trim();
  const bucket = takeoverListeners.get(sid) ?? new Set<(on: boolean) => void>();
  bucket.add(listener);
  takeoverListeners.set(sid, bucket);
  listener(takeovers.has(sid));
  return () => {
    bucket.delete(listener);
    if (bucket.size === 0) takeoverListeners.delete(sid);
  };
}

export function subscribeBrowserAgentActivity(
  sessionId: string,
  listener: () => void,
): () => void {
  const sid = sessionId.trim();
  const bucket = activityListeners.get(sid) ?? new Set<() => void>();
  bucket.add(listener);
  activityListeners.set(sid, bucket);
  return () => {
    bucket.delete(listener);
    if (bucket.size === 0) activityListeners.delete(sid);
  };
}

export function getBrowserAgentInFlight(sessionId: string): number {
  return inFlight.get(sessionId.trim()) ?? 0;
}

function markActivity(sessionId: string, delta: number): void {
  const sid = sessionId.trim();
  const next = Math.max(0, (inFlight.get(sid) ?? 0) + delta);
  if (next === 0) inFlight.delete(sid);
  else inFlight.set(sid, next);
  const listeners = activityListeners.get(sid);
  if (listeners) {
    for (const listener of listeners) listener();
  }
}

function pickController(sessionId: string, action: string): BrowserAgentController | undefined {
  const exact = controllers.get(sessionId);
  if (exact) return exact;
  if (action === "open" && controllers.size > 0) {
    return controllers.values().next().value;
  }
  return undefined;
}

async function runAction(
  ctrl: BrowserAgentController,
  payload: NearBrowserActPayload,
): Promise<BrowserAgentResult> {
  const action = payload.action;
  if (action === "open") {
    const url = String(payload.url || "").trim();
    if (!url) return { ok: false, error: "missing_url" };
    return ctrl.open(url);
  }
  if (action === "snapshot") return ctrl.snapshot();
  if (action === "click") {
    const index = Number(payload.index);
    if (!Number.isInteger(index)) return { ok: false, error: "missing_index" };
    return ctrl.click(index);
  }
  if (action === "type") {
    const index = Number(payload.index);
    const text = String(payload.text ?? "");
    if (!Number.isInteger(index)) return { ok: false, error: "missing_index" };
    return ctrl.type(index, text, payload.submit === true);
  }
  if (action === "press_key") {
    const key = String(payload.key || "").trim();
    if (!key) return { ok: false, error: "missing_key" };
    return ctrl.pressKey(key);
  }
  if (action === "extract_text") {
    return ctrl.extractText(String(payload.query || "").trim() || undefined);
  }
  if (action === "screenshot") return ctrl.screenshot();
  return { ok: false, error: "unknown_action" };
}

/** Must be called from App/ChatPane, not only WorkPanel — a closed workspace never mounts. */
export function ensureBrowserAgentIpc(): void {
  if (browserAgentIpcWired) return;
  const api = window.agenticxDesktop;
  if (!api?.onNearBrowserAct || !api.replyNearBrowserAct) return;
  browserAgentIpcWired = true;
  api.onNearBrowserAct((payload) => {
    void (async () => {
      const requestId = String(payload?.request_id || "").trim();
      const sessionId = String(payload?.session_id || "").trim();
      const action = String(payload?.action || "").trim();
      const reply = async (result: BrowserAgentResult) => {
        await api.replyNearBrowserAct({
          ...result,
          request_id: requestId,
          session_id: sessionId,
        });
      };
      if (!requestId || !sessionId || !action) {
        await reply({ ok: false, error: "invalid_payload" });
        return;
      }
      if (isBrowserHumanTakeover(sessionId)) {
        await reply({
          ok: false,
          error: "human_takeover",
          hint: "用户已接管浏览器，请停止自动操作并询问用户下一步。",
        });
        return;
      }
      const ctrl = pickController(sessionId, action);
      if (!ctrl) {
        if (action === "open") {
          const fallback = openFallbacks.get(sessionId);
          const url = String(payload.url || "").trim();
          if (!url) {
            await reply({ ok: false, error: "missing_url" });
            return;
          }
          if (fallback) {
            markActivity(sessionId, 1);
            try {
              const opened = await fallback(url);
              if (opened.ok) {
                const late = await waitForController(sessionId);
                if (late) {
                  try {
                    const again = await late.open(url);
                    await reply(again.ok ? again : opened);
                    return;
                  } catch {
                    await reply(opened);
                    return;
                  }
                }
              }
              await reply(opened);
            } catch (err) {
              await reply({
                ok: false,
                error: "guest_not_ready",
                hint: err instanceof Error ? err.message : String(err),
              });
            } finally {
              markActivity(sessionId, -1);
            }
            return;
          }
        }
        await reply({
          ok: false,
          error: "no_browser_pane",
          hint: "右侧工作区浏览器未就绪，请再试一次打开页面。",
        });
        return;
      }
      markActivity(sessionId, 1);
      try {
        const result = await runAction(ctrl, {
          request_id: requestId,
          session_id: sessionId,
          action,
          url: payload.url,
          index: payload.index,
          text: payload.text,
          key: payload.key,
          submit: payload.submit,
          query: payload.query,
        });
        await reply(result);
      } catch (err) {
        await reply({
          ok: false,
          error: "guest_not_ready",
          hint: err instanceof Error ? err.message : String(err),
        });
      } finally {
        markActivity(sessionId, -1);
      }
    })();
  });
}

export function _resetBrowserAgentRegistryForTests(): void {
  controllers.clear();
  openFallbacks.clear();
  takeovers.clear();
  activityListeners.clear();
  takeoverListeners.clear();
  inFlight.clear();
  browserAgentIpcWired = false;
  controllerWaitMs = 2500;
}
