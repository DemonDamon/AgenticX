// SP5 · 划词/整页注入 session — context-menu entry (browser → agent direction ONLY).
//
// Two chrome.contextMenus items:
//   「划词发给 AGX」 (contexts: selection) → window.getSelection().toString()
//   「整页发给 AGX」 (contexts: page)      → SP3 collector (agxPageExtractCollector)
//        + document.title, trimmed to TEXT_CAP (20k chars, plan §1.1).
//
// Permission posture (plan §0, master plan 3.6): no standing host grant —
// the first send to a site requests ONLY that origin via
// chrome.permissions.request({origins:["<scheme>://<host>/*"]}) from the
// context-menu user gesture. Denial is never silent: storage marker +
// chrome.notifications toast. Granted origins are visible/revocable in the
// options page.
//
// Transport: payload {type:"inject_context", request_id, session_id?, url,
// title, text, kind, truncated} over the SP1 NM port (agxNmSendInject is
// defined in sw.js). session_id = the most recent {type:"active_session"}
// push cached in chrome.storage.local; absent → desktop resolves the latest
// active Studio session (P1 rule). The desktop replies with
// {type:"inject_context_result"}; !ok → toast "AGX 未运行…", never a drop.
//
// Test seams (automation only — CDP can evaluate inside the SW, pages
// cannot): agxPermissionContainsFn / agxPermissionRequestFn are mutable
// module globals so e2e can force the first-time/denied branches without
// clicking Chrome's native prompt (native prompts are not automatable —
// SP1 finding #1 family). Defaults are the real chrome.permissions APIs.

const AGX_MENU_SELECTION_ID = "agx-inject-selection";
const AGX_MENU_PAGE_ID = "agx-inject-page";
/** SP7c · 划词联动侧边栏菜单（仅此一项新增；既有两项行为不变）。 */
const AGX_MENU_COPILOT_ID = "agx-copilot-selection";
/** SP7c · 终态记录 key（与 agx_inject_last_result 同族的防静默契约）。 */
const AGX_COPILOT_SELECTION_RESULT_KEY = "agx_copilot_selection_last_result";
/** Plan §1.1: trim collected text to 20k characters. */
const AGX_INJECT_TEXT_CAP = 20000;
const AGX_ACTIVE_SESSION_KEY = "agx_active_session";
const AGX_INJECT_RESULT_KEY = "agx_inject_last_result";

/** Automation seam: defaults to the real chrome.permissions.contains. */
let agxPermissionContainsFn = (origins) => chrome.permissions.contains({ origins });
/** Automation seam: defaults to the real chrome.permissions.request
 *  (valid here because context-menu clicks carry the user gesture). */
let agxPermissionRequestFn = (origins) => chrome.permissions.request({ origins });
/** SP7c automation seam: defaults to the real chrome.sidePanel.open. MV3 menu
 *  dispatch often loses the user gesture → open() rejects; e2e forces the
 *  open-ok / open-throw branches through this mutable global (same pattern as
 *  the permission seams above). */
let agxSidePanelOpenFn = (options) => chrome.sidePanel.open(options);

function agxInjectLog(...args) {
  console.log("[agx-inject]", ...args);
}

/** Origin pattern for the optional host grant: http(s) only, host-wide
 *  (match patterns cannot carry ports — any port on the host matches). */
function agxBuildOriginPattern(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname;
  if (!host) return null;
  return `${parsed.protocol}//${host}/*`;
}

/** Page-world collector for the selection menu item (self-contained:
 *  chrome.scripting serializes this single function). */
function agxPageSelectionCollector() {
  const sel = window.getSelection ? String(window.getSelection().toString() || "") : "";
  return { url: location.href, title: document.title || "", text: sel.trim() };
}

/** Menu ids confirmed by real chrome.contextMenus.create callbacks; set once
 *  both items registered (this Chrome build exposes no contextMenus.getAll,
 *  so this registry is also the e2e's registration probe). */
let agxInjectMenuIds = null;

function agxRegisterInjectMenus() {
  // removeAll → create keeps onInstalled idempotent across extension reloads.
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      agxInjectLog("menu removeAll failed:", chrome.runtime.lastError.message);
      return;
    }
    const registered = [];
    const register = (item) =>
      chrome.contextMenus.create(item, () => {
        if (chrome.runtime.lastError) {
          agxInjectLog("menu create failed:", chrome.runtime.lastError.message);
          return;
        }
        registered.push(item.id);
        if (registered.length === 3) {
          agxInjectMenuIds = registered.slice();
        }
      });
    register({
      id: AGX_MENU_SELECTION_ID,
      title: "划词发给 AGX",
      contexts: ["selection"],
    });
    register({
      id: AGX_MENU_PAGE_ID,
      title: "整页发给 AGX",
      contexts: ["page"],
    });
    register({
      id: AGX_MENU_COPILOT_ID,
      title: "划词问 AGX（侧边栏）",
      contexts: ["selection"],
    });
  });
}

/** Best-effort toast (chrome.notifications); returns whether it was accepted.
 *  The storage marker in agxRecordInjectResult is the durable record. */
function agxNotifyUser(message) {
  try {
    const created = chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "AGX",
      message,
    });
    // notifications.create may return a promise (async rejection would
    // otherwise escape the sync try/catch) — swallow it either way.
    Promise.resolve(created).catch(() => {
      /* notifications unavailable (OS permission etc.) */
    });
    return true;
  } catch (err) {
    agxInjectLog("notify failed:", err?.message ?? err);
    return false;
  }
}

function agxInjectFailureMessage(result) {
  const error = String(result.error || "");
  if (error === "nm_disconnected") return "AGX 未运行：无法连接 AGX 桌面端，页面内容未发送。";
  if (error === "studio_unreachable") return "AGX 未运行：无法访问 Studio 会话，页面内容未发送。";
  if (error === "session_not_found" || error === "no_active_session") {
    return "AGX 会话不可用：未找到活跃的 Studio 会话，页面内容未发送。";
  }
  if (error === "permission_denied") return "已拒绝该站点的注入权限，页面内容未发送。";
  if (error === "empty_text") return "未选取到可发送的内容。";
  return `页面内容发送失败：${error || "unknown"}`;
}

/** Terminal record for every menu click — the anti-silent-failure contract:
 *  failures toast AND persist; successes persist too (debug/e2e visibility). */
async function agxRecordInjectResult(result) {
  const row = { ...result, ts: Date.now() };
  if (row.ok !== true) {
    row.notified = agxNotifyUser(agxInjectFailureMessage(row));
  }
  try {
    await chrome.storage.local.set({ [AGX_INJECT_RESULT_KEY]: row });
  } catch (err) {
    agxInjectLog("persist result failed:", err?.message ?? err);
  }
  agxInjectLog("result:", JSON.stringify(row));
}

/** {type:"active_session"} push from the bridge → cache for the next inject. */
async function agxStoreActiveSession(message) {
  const sessionId = String(message?.session_id || "").trim();
  if (!sessionId) return;
  try {
    await chrome.storage.local.set({
      [AGX_ACTIVE_SESSION_KEY]: { session_id: sessionId, name: String(message.name || ""), ts: Date.now() },
    });
  } catch (err) {
    agxInjectLog("persist active session failed:", err?.message ?? err);
  }
}

async function agxReadActiveSessionId() {
  try {
    const data = await chrome.storage.local.get(AGX_ACTIVE_SESSION_KEY);
    const row = data?.[AGX_ACTIVE_SESSION_KEY];
    const sessionId = String(row?.session_id || "").trim();
    return sessionId || undefined;
  } catch {
    return undefined;
  }
}

async function agxCollectFromTab(tab, kind) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: kind === "selection" ? agxPageSelectionCollector : agxPageExtractCollector,
    args: [],
  });
  const row = results?.[0]?.result;
  if (!row || typeof row !== "object") {
    throw new Error("collector_no_result");
  }
  const raw = String(row.text || "").trim();
  return {
    url: String(row.url || tab.url || ""),
    title: String(row.title || tab.title || ""),
    raw,
  };
}

/** contextMenus.onClicked handler. kind comes from the menu item id; the
 *  permission gate runs first so nothing is collected before the grant. */
async function agxHandleContextMenuClick(info, tab) {
  const menuId = String(info?.menuItemId || "");
  if (menuId === AGX_MENU_COPILOT_ID) {
    void agxHandleCopilotSelectionClick(tab);
    return; // SP7c path — 既有两项菜单的行为在下方保持一行不改
  }
  const kind = menuId === AGX_MENU_SELECTION_ID ? "selection" : menuId === AGX_MENU_PAGE_ID ? "page" : null;
  if (!kind) return;
  if (!tab || typeof tab.id !== "number") {
    void agxRecordInjectResult({ ok: false, kind, error: "no_active_tab" });
    return;
  }
  const originPattern = agxBuildOriginPattern(tab.url);
  if (!originPattern) {
    void agxRecordInjectResult({ ok: false, kind, error: "unsupported_url" });
    return;
  }
  try {
    // Permission posture (real-machine finding, 2026-11-11): the context-menu
    // click itself activates activeTab, which alone authorizes executeScript
    // on this tab — the per-origin grant is an enhancement for gesture-less
    // future use, NOT a gate. MV3 often fails to forward the user gesture to
    // contextMenus.onClicked, so permissions.request *throws* there; that
    // throw must fall through to the activeTab path. An explicit `false`
    // return (user really saw and dismissed the prompt) is still honored
    // as a denial — nothing gets sent.
    let granted = false;
    let sawPromptAndDenied = false;
    try {
      granted = await agxPermissionContainsFn([originPattern]);
      if (!granted) {
        granted = await agxPermissionRequestFn([originPattern]);
        sawPromptAndDenied = !granted;
      }
    } catch (permErr) {
      granted = false; // gesture absent (expected on MV3 menu dispatch) — activeTab covers this click
      sawPromptAndDenied = false;
    }
    if (sawPromptAndDenied) {
      void agxRecordInjectResult({ ok: false, kind, stage: "permission", error: "permission_denied", origin: originPattern });
      return;
    }

    const collected = await agxCollectFromTab(tab, kind);
    const truncated = collected.raw.length > AGX_INJECT_TEXT_CAP;
    const text = truncated ? collected.raw.slice(0, AGX_INJECT_TEXT_CAP) : collected.raw;
    if (!text) {
      void agxRecordInjectResult({ ok: false, kind, error: "empty_text", url: collected.url });
      return;
    }

    // NM transport lives in sw.js: a down port here IS "AGX 未运行".
    const payload = {
      type: "inject_context",
      request_id: crypto.randomUUID(),
      session_id: await agxReadActiveSessionId(),
      url: collected.url,
      title: collected.title,
      text,
      kind,
      truncated,
    };
    const sent = agxNmSendInject(payload);
    if (sent !== true) {
      void agxRecordInjectResult({ ok: false, kind, error: "nm_disconnected", url: collected.url });
      return;
    }
    agxInjectLog(`sent ${kind} inject (${text.length} chars${truncated ? ", truncated" : ""})`, collected.url);
  } catch (err) {
    void agxRecordInjectResult({ ok: false, kind, error: String(err?.message ?? err), url: String(tab.url || "") });
  }
}

// ---------------------------------------------------------------------------
// SP7c · 划词问 AGX（侧边栏）— selection → copilot_chat → sidePanel.open
// ---------------------------------------------------------------------------

/** SP7c failure copy (mirror of agxInjectFailureMessage — same SP7b error
 *  family, selection-copilot wording). */
function agxCopilotSelectionFailureMessage(result) {
  const error = String(result.error || "");
  if (error === "nm_disconnected") return "AGX 未运行：无法连接 AGX 桌面端，划词未发送。";
  if (error === "sensitive_domain") {
    return `已拦截：敏感站点（${result.category || "sensitive"}）的划词不会发送。`;
  }
  if (error === "permission_denied") return "已拒绝该站点的注入权限，划词未发送。";
  if (error === "empty_text") return "未选取到可发送的内容。";
  if (error === "unsupported_url") return "该页面类型暂不支持划词发送。";
  if (error === "no_active_tab") return "未找到可发送的页面标签。";
  return `划词发送失败：${error || "unknown"}`;
}

/** SP7c terminal record for every 「划词问 AGX」click — same anti-silent-failure
 *  contract as agxRecordInjectResult (failures toast AND persist; successes
 *  persist for e2e/debug visibility, including the sidePanel.open fallback). */
async function agxRecordCopilotSelectionResult(result) {
  const row = { ...result, kind: "selection", ts: Date.now() };
  if (row.ok !== true && !("notified" in row)) {
    row.notified = agxNotifyUser(agxCopilotSelectionFailureMessage(row));
  }
  try {
    await chrome.storage.local.set({ [AGX_COPILOT_SELECTION_RESULT_KEY]: row });
  } catch (err) {
    agxInjectLog("persist copilot selection result failed:", err?.message ?? err);
  }
  agxInjectLog("copilot selection result:", JSON.stringify(row));
}

/** SP7c click flow: 敏感域名 gate（SP4 同一 verdict 函数，采集前拦截）→ activeTab
 *  采集 selection → 组装 {kind:"selection"} 走 SP7a 的 SW 发送路径
 *  （copilot.js agxHandleCopilotSend：copilot_chat + pending + 广播）→
 *  chrome.sidePanel.open({tabId})。
 *  SP5 教训：MV3 菜单派发常拿不到 user gesture → sidePanel.open 可能抛错；
 *  open 失败 ⇒ 消息照发 + notifications toast「已发送，点工具栏图标查看回答」
 *  （绝不静默）；发送失败（NM down）⇒ 记录 + toast，不 open 空面板。 */
async function agxHandleCopilotSelectionClick(tab) {
  if (!tab || typeof tab.id !== "number") {
    void agxRecordCopilotSelectionResult({ ok: false, error: "no_active_tab" });
    return;
  }
  // 敏感域名 gate — 与 SP4 executor 层同一 verdict 函数，非 open 动作按 tab_url 判定。
  let verdict = null;
  try {
    verdict = await agxSensitiveDomainVerdict("copilot_selection", { tab_url: tab.url });
  } catch (err) {
    verdict = { domain: "", category: "", tab_url: String(tab.url || "") }; // gate 自身故障 → 按拦截处理
    agxInjectLog("sensitive-domain verdict failed:", err?.message ?? err);
  }
  if (verdict) {
    void agxRecordCopilotSelectionResult({
      ok: false,
      error: "sensitive_domain",
      domain: verdict.domain,
      category: verdict.category,
      url: String(tab.url || ""),
    });
    return; // 银行/支付/邮箱/政务页：采集前拦截，不采集不发送
  }
  const originPattern = agxBuildOriginPattern(tab.url);
  if (!originPattern) {
    void agxRecordCopilotSelectionResult({ ok: false, error: "unsupported_url", url: String(tab.url || "") });
    return;
  }
  try {
    // 权限姿势照抄既有菜单：activeTab 覆盖本次点击；per-origin 增强在无手势时
    // 抛错 → 落回 activeTab 路径；显式拒绝 → 不发送。
    let granted = false;
    let sawPromptAndDenied = false;
    try {
      granted = await agxPermissionContainsFn([originPattern]);
      if (!granted) {
        granted = await agxPermissionRequestFn([originPattern]);
        sawPromptAndDenied = !granted;
      }
    } catch (permErr) {
      granted = false; // gesture absent (expected on MV3 menu dispatch) — activeTab covers this click
      sawPromptAndDenied = false;
    }
    if (sawPromptAndDenied) {
      void agxRecordCopilotSelectionResult({
        ok: false,
        stage: "permission",
        error: "permission_denied",
        origin: originPattern,
      });
      return;
    }

    const collected = await agxCollectFromTab(tab, "selection");
    const text = collected.raw;
    if (!text) {
      void agxRecordCopilotSelectionResult({ ok: false, error: "empty_text", url: collected.url });
      return;
    }

    // SP7a 发送路径（copilot.js）：组装 {type:"copilot_chat", kind:"selection",
    // text, source_url, source_title} 落 NM + pending 记录 + 已开面板广播。
    const sent = await agxHandleCopilotSend({
      text,
      kind: "selection",
      source_url: collected.url,
      source_title: collected.title,
    });
    if (sent !== true) {
      // nm_disconnected 已广播给已打开的面板；面板未开时由本记录的 toast 兜底，绝不静默。
      void agxRecordCopilotSelectionResult({ ok: false, error: "nm_disconnected", url: collected.url });
      return;
    }

    // sidePanel.open：SP5 教训 — 无 user gesture 时可能同步抛错或 Promise 拒绝。
    let opened = true;
    let openError = "";
    try {
      await agxSidePanelOpenFn({ tabId: tab.id });
    } catch (err) {
      opened = false;
      openError = String(err?.message ?? err);
    }
    if (!opened) {
      // 消息已照发；open 失败 ⇒ toast 兜底「已发送，点工具栏图标查看回答」。
      const toastMessage = "已发送，点工具栏图标查看回答";
      const notified = agxNotifyUser(toastMessage);
      void agxRecordCopilotSelectionResult({
        ok: true,
        opened: false,
        open_error: openError,
        toast_message: toastMessage,
        notified,
        url: collected.url,
      });
      return;
    }
    void agxRecordCopilotSelectionResult({ ok: true, opened: true, url: collected.url });
  } catch (err) {
    void agxRecordCopilotSelectionResult({
      ok: false,
      error: String(err?.message ?? err),
      url: String(tab.url || ""),
    });
  }
}

chrome.runtime.onInstalled.addListener(agxRegisterInjectMenus);
chrome.contextMenus.onClicked.addListener((info, tab) => {
  void agxHandleContextMenuClick(info, tab);
});
