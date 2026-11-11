// SP1 · NM Channel Spike — service worker (hand-rolled, no build toolchain).
//
// Proves the NM long connection survives MV3 SW recycling via:
//   - port.onDisconnect → exponential-backoff reconnect (1s → 30s ceiling);
//   - chrome.alarms "nm-heartbeat" (1 min): reconnect if the port is down,
//     else send ping and record RTT — the guaranteed fallback after SW
//     recycling, since MV3 kills the worker (~30s idle) even with a live Port.
//
// SP2 · ExtensionBackend: desktop act requests arrive as {type:"act",
// request_id, session_id, action, ...} and are dispatched to the executor;
// replies go back as {type:"act_result", ...result, request_id} — the bridge
// settles them by request_id. The heartbeat/reconnect logic above is untouched.
//
// SP3 · the default executor is real browser execution (executor/ modules:
// chrome.scripting on the active tab, captureVisibleTab, storage.session index
// cache). message.stub === true (the bridge forwards AGX_EXT_STUB=1) keeps the
// SP2 stub path (executor-stub.js) green for its acceptance run.
//
// State persisted under chrome.storage.local key "nm":
// {
//   status: "connected" | "disconnected",
//   lastConnectedAt, lastDisconnectedAt, lastPingAt, lastPongAt,
//   lastRttMs, reconnectAttempts,
//   rttSamples: [{ ts, rtt }]   // capped at 50
// }

importScripts("executor-stub.js");
importScripts(
  "safety/domains.js",
  "safety/confirm.js",
  "executor/shared.js",
  "executor/collector.js",
  "executor/open.js",
  "executor/snapshot.js",
  "executor/interact.js",
  "executor/extract.js",
  "executor/screenshot.js",
  "executor/index.js",
  "inject.js",
);

const HOST_NAME = "com.agenticx.bridge";
const ALARM_NAME = "nm-heartbeat";
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30000;
const RTT_SAMPLES_CAP = 50;
const STATE_KEY = "nm";

let port = null;
let reconnectAttempts = 0;
let retryTimer = null;
// In-memory mirror mutated synchronously (avoids read-modify-write races);
// persisted fire-and-forget.
let state = { status: "disconnected", reconnectAttempts: 0, rttSamples: [] };

function log(...args) {
  console.log("[agx-nm-sw]", ...args);
}

function saveState(patch) {
  Object.assign(state, patch);
  if (Array.isArray(state.rttSamples) && state.rttSamples.length > RTT_SAMPLES_CAP) {
    state.rttSamples = state.rttSamples.slice(-RTT_SAMPLES_CAP);
  }
  const snapshot = { ...state, rttSamples: [...state.rttSamples] };
  chrome.storage.local.set({ [STATE_KEY]: snapshot }).catch((err) => {
    log("persist failed:", err?.message ?? err);
  });
}

function recordRtt(pingTs) {
  const rtt = Date.now() - pingTs;
  const samples = [...(state.rttSamples ?? []), { ts: Date.now(), rtt }].slice(-RTT_SAMPLES_CAP);
  saveState({ status: "connected", lastPongAt: Date.now(), lastRttMs: rtt, rttSamples: samples });
  return rtt;
}

function scheduleReconnect() {
  const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  saveState({ status: "disconnected", lastDisconnectedAt: Date.now(), reconnectAttempts });
  if (retryTimer) clearTimeout(retryTimer);
  // setTimeout only holds while this SW stays alive (~30s idle); the heartbeat
  // alarm is the guaranteed fallback after SW recycling.
  retryTimer = setTimeout(connect, delay);
  log(`reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
}

function connect() {
  if (port) return;
  let fresh;
  try {
    fresh = chrome.runtime.connectNative(HOST_NAME);
  } catch (err) {
    log("connectNative threw:", err?.message ?? err);
    scheduleReconnect();
    return;
  }
  port = fresh;
  port.onMessage.addListener(onNativeMessage);
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? "port closed";
    port = null;
    log("disconnected:", reason);
    scheduleReconnect();
  });
  saveState({ lastConnectedAt: Date.now() });
  sendPing(); // verify the fresh shim end-to-end immediately
}

function sendPing() {
  if (!port) return;
  const ts = Date.now();
  try {
    port.postMessage({ type: "ping", ts });
    saveState({ lastPingAt: ts });
  } catch (err) {
    log("postMessage failed:", err?.message ?? err); // dead port → onDisconnect follows
  }
}

function onNativeMessage(message) {
  if (message && message.type === "pong" && typeof message.ts === "number") {
    const rtt = recordRtt(message.ts);
    log(`pong rtt=${rtt}ms`);
    return;
  }
  if (message && message.type === "act" && message.request_id) {
    void handleAct(message); // executor is async (scripting/tabs await) — reply posts when done
    return;
  }
  // SP5: bridge pushes the latest active Studio session → cached for the
  // next inject (plan §1.2 "最近一次激活 session").
  if (message && message.type === "active_session") {
    void agxStoreActiveSession(message);
    return;
  }
  // SP5: terminal outcome of an inject_context send (fired from the bridge's
  // dispatch) → recorded + toasted on failure, never dropped silently.
  if (message && message.type === "inject_context_result") {
    void agxRecordInjectResult(message);
    return;
  }
  log("message:", message);
}

/**
 * SP5 transport for the inject module: post one inject_context payload on
 * the live NM port. Returns false when the port is down — that IS the
 * "AGX 未运行" pre-flight (desktop down ⇒ no NM host ⇒ no port).
 */
function agxNmSendInject(payload) {
  if (!port) return false;
  try {
    port.postMessage(payload);
    return true;
  } catch (err) {
    log("inject postMessage failed:", err?.message ?? err); // dead port → onDisconnect follows
    return false;
  }
}

/** SP3 dispatch: real executor by default; stub:true (bridge forwards
 *  AGX_EXT_STUB=1) keeps the SP2 stub path. All replies stay on the
 *  pending/settle pipeline — {type:"act_result", ...result, request_id}. */
async function handleAct(message) {
  let result;
  try {
    result =
      message.stub === true ? await executeActionStub(message) : await executeAction(message);
  } catch (err) {
    result = { ok: false, error: String(err?.message ?? err) };
  }
  if (!result || typeof result !== "object") {
    result = { ok: false, error: "invalid_executor_result" };
  }
  try {
    // SP4: stamp every reply with the extension source + the tab_url it acted
    // on, so the desktop audit trail can attribute actions to the extension.
    const reply = { ...result, source: "extension", request_id: message.request_id };
    if (!reply.tab_url) {
      reply.tab_url = String(result.url ?? result.tab_url ?? "");
    }
    port.postMessage({ type: "act_result", ...reply });
  } catch (err) {
    log("postMessage failed:", err?.message ?? err); // dead port → onDisconnect follows
  }
}

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  if (!port) {
    reconnectAttempts = 0; // a full alarm period passed — treat as fresh backoff
    connect();
  } else {
    sendPing();
  }
});

// SW cold start (launch or revival after recycling) ⇒ reconnect eagerly.
connect();
