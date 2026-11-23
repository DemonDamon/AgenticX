// SP3 · executor shared helpers (service-worker side).
//
// Loaded via importScripts() from sw.js; every module here defines plain
// functions in the SW global scope (classic scripts, no build toolchain —
// same convention as SP1/SP2).
//
// Author: Damon Li

/** chrome.storage.session key holding the latest snapshot (MV3-compliant:
 *  session-scoped memory, cleared when the browser exits). click/type locate
 *  elements by the index recorded in this cache. */
const AGX_SNAPSHOT_SESSION_KEY = "agx_last_snapshot";

/** Bridge budget for open/screenshot is 30s (timeoutMsFor); keep a small
 *  margin for the NM roundtrip so the reply never races the bridge timer. */
const AGX_OPEN_WAIT_BUDGET_MS = 28_000;

function agxSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The tab snapshot/interact/extract/screenshot act on: the active tab of the
 *  last focused window (the one the user — or a previous `open` — is looking at). */
async function agxGetActiveTab() {
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || tabs.length === 0) {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== "number") {
    throw new Error("no_active_tab");
  }
  return tab;
}

/** Run func in a tab; maps scripting failures (missing host permission on the
 *  tab, closed tab, …) into the SP3 error contract {ok:false, error}. */
async function agxInject(tabId, func, args) {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args: args ?? [],
    });
  } catch (err) {
    throw new Error(`scripting_failed: ${err?.message ?? err}`);
  }
  const row = Array.isArray(results) ? results[0] : null;
  if (!row || typeof row.result !== "object" || row.result === null) {
    throw new Error("scripting_no_result");
  }
  return row.result;
}

async function agxReadLastSnapshot() {
  const store = await chrome.storage.session.get(AGX_SNAPSHOT_SESSION_KEY);
  return store?.[AGX_SNAPSHOT_SESSION_KEY] ?? null;
}

async function agxWriteLastSnapshot(snapshot) {
  await chrome.storage.session.set({ [AGX_SNAPSHOT_SESSION_KEY]: snapshot });
}

/**
 * click/type require an index from the latest snapshot (agent prompt:
 * "每次点击/输入前必须先 snapshot"). Fast-fails with the embedded backend's
 * stale_index semantics when there is no snapshot, the index is unknown, or
 * the active tab is not the tab the snapshot was taken on.
 * Returns {snapshot, element} or {error}.
 */
async function agxResolveIndexedTarget(index) {
  const snapshot = await agxReadLastSnapshot();
  if (!snapshot || !Array.isArray(snapshot.elements)) {
    return { error: { ok: false, error: "stale_index", hint: "尚无 snapshot，请先调用 snapshot" } };
  }
  const element = snapshot.elements.find((el) => el && el.index === index);
  if (!element) {
    return { error: { ok: false, error: "stale_index", hint: "index 不在最近一次 snapshot 中，请重新 snapshot" } };
  }
  const tab = await agxGetActiveTab();
  if (typeof snapshot.tabId === "number" && tab.id !== snapshot.tabId) {
    return { error: { ok: false, error: "stale_index", hint: "当前 tab 与最近一次 snapshot 不一致，请重新 snapshot" } };
  }
  return { snapshot, element, tab };
}
