// SP7a · Copilot 侧边栏面板 — minimal chat shell over the NM channel.
//
// Transport (plan §2.2):
//   send:    chrome.runtime.sendMessage({cmd:"agx_copilot_send", text}) → SW
//   replies: chrome.runtime.onMessage ← SW broadcasts
//              {cmd:"agx_copilot_reply", request_id, session_id?, ok, text?, error?}
//              {cmd:"agx_nm_status", status, pending_request_id} (reconnect push)
//              {cmd:"agx_copilot_pending", request_id, kind:"selection",
//               text_preview, source_url, source_title} (SP7c 划词预填态)
//
// 状态机: idle → busy（禁用输入）→ idle / error（红字，文案映射复用 SP5/SP7b
// error 家族）。发送失败的输入内容保留不丢；划词消息在面板打开时以 pending
// 记录恢复预填（首行+200 字符）+ 来源标注条。
//
// SP7c 渲染边界（plan §1.2）：回复走 markdown-lite 手写渲染器 —— 先 escape
// 全部 HTML，再支持加粗/行内代码/代码块/链接/换行；用户气泡保持纯文本
// textContent。任何用户/agent 文本都不得以非 escape 形态进 DOM。

const AGX_ACTIVE_SESSION_KEY = "agx_active_session";
const AGX_COPILOT_PENDING_KEY = "agx_copilot_pending";
/** SP7c：面板客户端回复超时。真机结论（2026-11-12）：真实 claude-code
 * turn 首个 token 可能 >30s —— 预算与桌面端 bridge 同步放宽到 90s。 */
const AGX_REPLY_TIMEOUT_MS = 90000;

const $ = (id) => document.getElementById(id);
const input = $("input");
const sendBtn = $("send");
const messages = $("messages");
const statusEl = $("status");

let busy = false;
let nmDown = false;
let replyTimer = null;

function agxPanelLog(...args) {
  console.log("[agx-panel]", ...args);
}

/** Error copy mirrors agxInjectFailureMessage / SP7b desktop error family. */
function agxPanelFailureMessage(error) {
  const code = String(error || "");
  if (code === "nm_disconnected") return "AGX 未运行：无法连接 AGX 桌面端";
  if (code === "studio_unreachable") return "AGX 未运行：无法访问 Studio 会话，消息未发送。";
  if (code === "session_not_found" || code === "no_active_session") {
    return "AGX 会话不可用：未找到活跃的 Studio 会话，消息未发送。";
  }
  if (code === "copilot_not_configured") return "AGX 桌面端未配置 Studio 连接，消息未发送。";
  if (code === "empty_text") return "请输入内容后再发送。";
  if (code === "reply_timeout") return "已发送到桌面端会话，回答超时。";
  if (code === "reply_empty") {
    return "会话正忙或未产生回复：消息可能未送达，请稍后重试，或到桌面端 Studio 查看。";
  }
  return `发送失败：${code || "unknown"}`;
}

// ---------------------------------------------------------------------------
// SP7c · markdown-lite 渲染器（手写，无 markdown 库）
//
// 安全规则：第 1 步先 escape 全部 HTML（& < > " '），之后只在该已 escape 的
// 字符串上做标记替换并合成受限标签 —— 用户/agent 文本没有任何路径能以未
// escape 形态进入 DOM。链接仅允许 http(s):// scheme（在已 escape 文本上做
// 前缀判定，":" "/" 不属于被 escape 字符，判定等价于原始文本）。
// ---------------------------------------------------------------------------

function agxPanelEscapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** markdown-lite：加粗 **x**、行内代码 `x`、代码块 ```…```、链接 [t](http…)
 *  与换行。代码块/行内代码先用占位符摘出（内容不再参与其它替换，换行在
 *  <pre> 内保持字面 \n），最后回填。占位符含 U+0000，页面文本不可能出现。 */
function agxPanelRenderMarkdownLite(raw) {
  const escaped = agxPanelEscapeHtml(String(raw ?? ""));
  const blocks = [];
  const inlines = [];
  let work = escaped.replace(/```([\s\S]*?)(?:```|$)/g, (_, body) => {
    blocks.push(`<pre><code>${body.replace(/^\n/, "")}</code></pre>`);
    return `agx-md-block-${blocks.length - 1}\u0000`;
  });
  work = work.replace(/`([^`\n]+)`/g, (_, body) => {
    inlines.push(`<code>${body}</code>`);
    return `agx-md-code-${inlines.length - 1}\u0000`;
  });
  work = work.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  work = work.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  work = work.replaceAll("\n", "<br>");
  work = work.replace(/agx-md-block-(\d+)\u0000/g, (_, i) => blocks[Number(i)] ?? "");
  work = work.replace(/agx-md-code-(\d+)\u0000/g, (_, i) => inlines[Number(i)] ?? "");
  return work;
}

// ---------------------------------------------------------------------------
// DOM builders（ createElement/textContent 路径，不经 innerHTML）
// ---------------------------------------------------------------------------

function appendMessage(role, text) {
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  if (role === "assistant") {
    // 回复走 markdown-lite：输入已全量 escape，仅受限标签为合成产物。
    row.innerHTML = agxPanelRenderMarkdownLite(text);
  } else {
    row.textContent = text; // 用户气泡保持纯文本
  }
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

/** SP7c 划词预填态：pending 的选中文本摘要气泡 + 来源标注条（链接可点）。 */
function appendSelectionPending(pending) {
  const row = document.createElement("div");
  row.className = "msg user selection";
  row.textContent = String(pending?.text_preview ?? "");
  messages.appendChild(row);

  const bar = document.createElement("div");
  bar.className = "source-bar";
  const url = String(pending?.source_url ?? "");
  const title = String(pending?.source_title ?? "").trim();
  if (/^https?:\/\//i.test(url)) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `来自页面：${title || url}`;
    bar.appendChild(link);
  } else {
    bar.textContent = "来自页面";
  }
  messages.appendChild(bar);
  messages.scrollTop = messages.scrollHeight;
}

function setStatus(text, isError) {
  statusEl.textContent = text || "";
  statusEl.className = isError ? "error" : "";
}

function setBusy(next) {
  busy = next;
  input.disabled = next;
  sendBtn.disabled = next;
}

// ---------------------------------------------------------------------------
// SP7c 客户端 reply_timeout（30s）—— 桌面端会话已收到该 turn
// （keep_runtime_after_disconnect），超时仅提示，不回滚不重发。
// ---------------------------------------------------------------------------

function clearReplyTimeout() {
  if (replyTimer) {
    clearTimeout(replyTimer);
    replyTimer = null;
  }
}

function armReplyTimeout() {
  clearReplyTimeout();
  replyTimer = setTimeout(() => {
    replyTimer = null;
    if (!busy) return;
    setBusy(false);
    setStatus(agxPanelFailureMessage("reply_timeout"), true);
  }, AGX_REPLY_TIMEOUT_MS);
}

function send() {
  if (busy) return;
  const text = input.value.trim();
  if (!text) return;
  appendMessage("user", text);
  setBusy(true);
  setStatus("AGX 正在回复…", false);
  armReplyTimeout();
  // The input keeps the text until a successful reply clears it — a failed
  // send（AGX 未运行等）因此不会丢掉用户输入。
  chrome.runtime.sendMessage({ cmd: "agx_copilot_send", text }).catch(() => {
    /* SW 唤醒/传输异常都会以 agx_copilot_reply 广播的形式落地 */
  });
}

function handleReply(message) {
  if (!busy) return; // stale broadcast（回复到达前面板曾重开等）
  clearReplyTimeout();
  setBusy(false);
  if (message.ok === true) {
    input.value = "";
    appendMessage("assistant", String(message.text ?? ""));
    setStatus("", false);
  } else {
    nmDown = message.error === "nm_disconnected";
    setStatus(agxPanelFailureMessage(message.error), true);
  }
}

/** SP7c：划词菜单发送到达一个已打开的面板 → 预填态 + busy。 */
function handlePendingMessage(message) {
  if (busy) return; // 单条在途（plan §0：不做多轮排队）
  if (message?.kind !== "selection") return;
  appendSelectionPending(message);
  setBusy(true);
  setStatus("AGX 正在回复…", false);
  armReplyTimeout();
}

function handleNmStatus(message) {
  if (message?.status === "connected" && nmDown && !busy) {
    nmDown = false;
    setStatus("", false); // AGX 已重新连接 — 清掉过期的「AGX 未运行」提示
  }
}

async function refreshSessionName() {
  let name = "";
  try {
    const data = await chrome.storage.local.get(AGX_ACTIVE_SESSION_KEY);
    name = String(data?.[AGX_ACTIVE_SESSION_KEY]?.name || "").trim();
  } catch (err) {
    agxPanelLog("read active session failed:", err?.message ?? err);
  }
  $("session-name").textContent = name
    ? `会话：${name}`
    : "未绑定会话：将发送给最近活跃的 AGX 会话";
}

/** Plan §2.3 面板自持: a request still outstanding (SW pending marker in
 *  chrome.storage.session) ⇒ reopen as busy and wait for the reply.
 *  SP7c：划词 pending 记录额外带预填摘要与来源 → 打开即显示。 */
async function restoreBusyFromPending() {
  try {
    const data = await chrome.storage.session.get(AGX_COPILOT_PENDING_KEY);
    const pending = data?.[AGX_COPILOT_PENDING_KEY];
    if (pending?.request_id) {
      if (pending.kind === "selection") appendSelectionPending(pending);
      setBusy(true);
      setStatus("AGX 正在回复…", false);
      armReplyTimeout();
    }
  } catch {
    /* storage.session 不可用 — 保持 idle */
  }
}

sendBtn.addEventListener("click", send);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault(); // Enter 发送，Shift+Enter 换行
    send();
  }
});
chrome.runtime.onMessage.addListener((message) => {
  if (message?.cmd === "agx_copilot_reply") handleReply(message);
  else if (message?.cmd === "agx_copilot_pending") handlePendingMessage(message);
  else if (message?.cmd === "agx_nm_status") handleNmStatus(message);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[AGX_ACTIVE_SESSION_KEY]) void refreshSessionName();
});

refreshSessionName();
restoreBusyFromPending();
