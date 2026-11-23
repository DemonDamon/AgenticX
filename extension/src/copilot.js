// SP7a · Copilot 面板路由 — the panel ⇄ SW ⇄ NM leg of the copilot protocol
// (plan §1 contract, shared with SP7b/SP7c):
//
//   panel → SW (chrome.runtime.sendMessage):
//     {cmd:"agx_copilot_send", text, source_url?, source_title?, kind?}
//   SW → panel (broadcast, chrome.runtime.sendMessage):
//     {cmd:"agx_copilot_reply", request_id, session_id?, ok, text?, error?}
//   SW → desktop (NM, via agxNmSendCopilot in sw.js):
//     {type:"copilot_chat", request_id, session_id?, text,
//      source_url?, source_title?, kind?}
//   desktop → SW (NM, branch in sw.js onNativeMessage):
//     {type:"copilot_reply", request_id, session_id, ok, text?, error?}
//
// session_id = the cached {type:"active_session"} push (inject.js storage
// key); absent → the desktop resolves the latest active Studio session (the
// SP5 P1 rule). The pending request_id lives in chrome.storage.session so an
// MV3 SW recycle between send and reply still matches/clears it (plan §2.3
// 面板自持).

const AGX_COPILOT_PENDING_KEY = "agx_copilot_pending";

function agxCopilotLog(...args) {
  console.log("[agx-copilot]", ...args);
}

/** Fire-and-forget broadcast to extension pages (the panel). "Receiving end
 *  does not exist"（面板未打开）is normal — swallow it either way. */
function agxCopilotBroadcast(message) {
  try {
    Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => {});
  } catch (err) {
    agxCopilotLog("broadcast failed:", err?.message ?? err);
  }
}

/** SP7c 划词预填摘要：首行 + 200 字符截断（plan §1.2）。 */
function agxCopilotPreview(text) {
  const raw = String(text ?? "");
  const firstLine = raw.split("\n", 1)[0] || raw;
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine;
}

async function agxCopilotReadPending() {
  try {
    const data = await chrome.storage.session.get(AGX_COPILOT_PENDING_KEY);
    return data?.[AGX_COPILOT_PENDING_KEY] ?? null;
  } catch {
    return null;
  }
}

/** Panel send: assemble the §1 copilot_chat payload and post it on the NM
 *  port. Port down ⇒ broadcast nm_disconnected immediately — mode-aligned
 *  with the inject pre-flight, never a silent drop.
 *  SP7c: returns true when the payload went out on the port (the inject.js
 *  划词问 AGX menu depends on it to decide the sidePanel.open/toast leg);
 *  selection sends additionally persist the panel-facing pending record
 *  (preview + source) and broadcast it so an ALREADY-open panel renders the
 *  划词预填态 — a panel opened afterwards gets it from storage instead. */
async function agxHandleCopilotSend(message) {
  const payload = {
    type: "copilot_chat",
    request_id: crypto.randomUUID(),
    session_id: await agxReadActiveSessionId(), // inject.js cache; may be undefined
    text: String(message?.text ?? ""),
  };
  if (message?.source_url) payload.source_url = String(message.source_url);
  if (message?.source_title) payload.source_title = String(message.source_title);
  if (message?.kind) payload.kind = String(message.kind);
  const sent = agxNmSendCopilot(payload); // sw.js — false ⇒ AGX 未运行
  if (sent !== true) {
    agxCopilotLog("send failed: NM port down");
    agxCopilotBroadcast({
      cmd: "agx_copilot_reply",
      request_id: payload.request_id,
      ok: false,
      error: "nm_disconnected",
    });
    return false;
  }
  let pendingRow = { request_id: payload.request_id, ts: Date.now() };
  if (payload.kind === "selection") {
    pendingRow = {
      ...pendingRow,
      kind: "selection",
      text_preview: agxCopilotPreview(payload.text),
      source_url: payload.source_url ?? "",
      source_title: payload.source_title ?? "",
    };
  }
  try {
    await chrome.storage.session.set({
      [AGX_COPILOT_PENDING_KEY]: pendingRow,
    });
  } catch (err) {
    agxCopilotLog("persist pending failed:", err?.message ?? err);
  }
  if (pendingRow.kind === "selection") {
    // 已打开的面板同步进入划词预填态（busy）；未开面板由 storage.pending 在
    // 加载时恢复 — 两条路径最终渲染同一条记录。
    agxCopilotBroadcast({ cmd: "agx_copilot_pending", ...pendingRow });
  }
  agxCopilotLog(`sent copilot_chat (${payload.text.length} chars, request_id=${payload.request_id})`);
  return true;
}

/** Desktop {type:"copilot_reply"} (branch in sw.js onNativeMessage) → clear
 *  the pending marker and broadcast to the panel. */
async function agxHandleCopilotReply(message) {
  const pending = await agxCopilotReadPending();
  if (!pending || pending.request_id === message.request_id) {
    try {
      await chrome.storage.session.remove(AGX_COPILOT_PENDING_KEY);
    } catch (err) {
      agxCopilotLog("clear pending failed:", err?.message ?? err);
    }
  }
  const reply = {
    cmd: "agx_copilot_reply",
    request_id: String(message.request_id ?? ""),
    ok: message.ok === true,
  };
  if (message.session_id) reply.session_id = String(message.session_id);
  if (reply.ok) reply.text = String(message.text ?? "");
  else reply.error = String(message.error ?? "unknown");
  agxCopilotBroadcast(reply);
  agxCopilotLog(`reply ok=${reply.ok} (request_id=${reply.request_id})`);
}

/** Plan §2.3: after a reconnect (the first pong following a disconnected
 *  stretch — see recordRtt in sw.js) the SW pushes the NM state once so an
 *  open panel self-heals instead of showing a stale「AGX 未运行」hint. */
function agxCopilotBroadcastNmStatus() {
  void (async () => {
    const pending = await agxCopilotReadPending();
    agxCopilotBroadcast({
      cmd: "agx_nm_status",
      status: "connected",
      pending_request_id: pending?.request_id ?? null,
    });
  })();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.cmd === "agx_copilot_send") {
    void agxHandleCopilotSend(message);
  }
  // Every outcome reaches the panel as an agx_copilot_reply broadcast — no
  // sendResponse channel is kept open.
  return false;
});

// SP7c 工具栏图标接线：manifest 已移除 action.default_popup（SP1 debug 弹窗），
// setPanelBehavior(openPanelOnActionClick) 让点图标 = 打开 Copilot 侧边栏。
// 旧 Chrome 无该 API / 拒绝时静默容错（面板仍可经划词菜单打开）。
try {
  Promise.resolve(chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })).catch(() => {
    /* setPanelBehavior rejected (older Chrome) — panel opens via menu only */
  });
} catch (err) {
  agxCopilotLog("setPanelBehavior failed:", err?.message ?? err);
}
