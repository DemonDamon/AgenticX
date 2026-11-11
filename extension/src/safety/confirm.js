// SP4 · safety layer — high-risk action confirmation card.
//
// Trigger conditions (deliberately exactly these three, SP4 plan §1.2):
//   a) `type` whose snapshot target is input[type=password]
//   b) `click` whose snapshot target is a form submit button (type=submit) or
//      any button inside a form
//   c) `press_key` of Enter while the page focus is inside a form
//
// The card is injected via chrome.scripting into a SHADOW DOM (open root on a
// fixed-position host): the site's CSS cannot restyle it and the card never
// touches site DOM beyond its own host element. 30s without a response counts
// as a rejection. Allow → the action proceeds with confirmed:true; deny → the
// action is refused (error:"user_declined").
//
// Page functions below are self-contained (chrome.scripting serializes only
// the passed func — no outer references), same convention as collector.js.
//
// Author: Damon Li

/** Card lifetime: 30s without a click counts as "deny" (SP4 plan §1.2). */
const AGX_CONFIRM_TIMEOUT_S = 30;

/**
 * Focus probe (page function, self-contained): does the active element live
 * inside a form? Used by press_key-Enter gating only.
 */
function agxPageFocusInfo() {
  const el = document.activeElement || document.body;
  const inForm = !!(el && (el.form || (el.closest && el.closest("form"))));
  return { in_form: inForm, tag: (el && el.tagName ? el.tagName : "").toLowerCase() };
}

/**
 * Confirmation card (page function, self-contained). Renders a shadow-DOM
 * card and returns a Promise that settles with {decision} when the user
 * clicks allow/deny or the timeout elapses. chrome.scripting awaits Promises
 * returned by injected funcs, so the SW side simply awaits agxInject().
 */
function agxPageConfirmCard(summary, timeoutSec) {
  return new Promise((resolve) => {
    const stale = document.getElementById("agx-confirm-card");
    if (stale) stale.remove();
    const host = document.createElement("div");
    host.id = "agx-confirm-card";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .backdrop { position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(15, 18, 25, 0.35); display: flex;
          align-items: center; justify-content: center;
          font: 14px/1.5 system-ui, -apple-system, "PingFang SC", sans-serif; }
        .card { background: #fff; color: #1c2128; border-radius: 12px;
          box-shadow: 0 12px 40px rgba(0,0,0,.28); padding: 18px 20px;
          width: 340px; max-width: calc(100vw - 32px); }
        .title { font-weight: 600; font-size: 15px; margin: 0 0 8px; }
        .summary { margin: 0 0 6px; word-break: break-all; }
        .meta { margin: 0 0 14px; color: #6a737d; font-size: 12px; }
        .row { display: flex; gap: 10px; justify-content: flex-end; }
        button { font: inherit; border-radius: 8px; border: 1px solid #d0d7de;
          padding: 7px 16px; cursor: pointer; background: #fff; }
        #agx-confirm-allow { background: #1f6feb; border-color: #1f6feb; color: #fff; }
        #agx-confirm-deny { font-weight: 600; }
      </style>
      <div class="backdrop">
        <div class="card" role="dialog" aria-modal="true">
          <p class="title">AGX 浏览器代理请求执行操作</p>
          <p class="summary"></p>
          <p class="meta">来源：AGX 桌面端 agent · <span id="agx-confirm-countdown"></span></p>
          <div class="row">
            <button id="agx-confirm-deny" type="button">拒绝</button>
            <button id="agx-confirm-allow" type="button">允许执行</button>
          </div>
        </div>
      </div>`;
    root.querySelector(".summary").textContent = String(summary || "");
    document.documentElement.appendChild(host);
    let settled = false;
    let timer = null;
    const finish = (decision) => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      host.remove();
      resolve({ decision });
    };
    root.getElementById("agx-confirm-allow").addEventListener("click", () => finish("allow"));
    root.getElementById("agx-confirm-deny").addEventListener("click", () => finish("deny"));
    const deadline = Date.now() + Math.max(1, Number(timeoutSec) || AGX_CONFIRM_TIMEOUT_S) * 1000;
    const countdown = root.getElementById("agx-confirm-countdown");
    const render = () => {
      const rest = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      countdown.textContent = `${rest}s 未响应将自动拒绝`;
    };
    render();
    timer = setInterval(() => {
      if (Date.now() >= deadline) {
        finish("deny_timeout");
        return;
      }
      render();
    }, 500);
  });
}

// ---------------------------------------------------------------------------
// SW-side gating
// ---------------------------------------------------------------------------

/**
 * Should this action pop a confirmation card?
 * Returns null (no card) or {reason, summary, tabId}.
 * `target` is the preActionHook target ({url,index,text,key,tab_url}).
 */
async function agxConfirmRequired(action, target) {
  const tabId = Number(target?.tab_id);
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  if (action === "type") {
    const element = await agxSnapshotElementForIndex(target?.index);
    if (element && element.is_password === true) {
      return {
        reason: "type_password",
        tabId,
        summary: `向密码输入框输入 ${String(target?.text ?? "").length} 个字符（目标 index=${Number(target?.index)}）`,
      };
    }
    return null;
  }
  if (action === "click") {
    const element = await agxSnapshotElementForIndex(target?.index);
    if (!element || element.tag !== "button") return null;
    const isSubmit = String(element.type || "").toLowerCase() === "submit";
    if (isSubmit || element.in_form === true) {
      const label = String(element.text || element.aria_label || "").slice(0, 40) || "(无文本)";
      return {
        reason: isSubmit ? "click_submit" : "click_form_button",
        tabId,
        summary: `点击表单按钮「${label}」（index=${Number(target?.index)}${isSubmit ? "，type=submit，可能提交表单" : "，位于表单内"}）`,
      };
    }
    return null;
  }
  if (action === "press_key") {
    const key = String(target?.key ?? "").trim();
    if (key.toLowerCase() !== "enter") return null;
    const info = await agxInject(tabId, agxPageFocusInfo, []);
    if (info && info.in_form === true) {
      return {
        reason: "press_enter_in_form",
        tabId,
        summary: `按 Enter（当前焦点在表单内，可能提交表单）`,
      };
    }
    return null;
  }
  return null;
}

/** Look one indexed element up in the latest snapshot cache (no page contact). */
async function agxSnapshotElementForIndex(index) {
  const snapshot = await agxReadLastSnapshot();
  if (!snapshot || !Array.isArray(snapshot.elements)) return null;
  return snapshot.elements.find((el) => el && el.index === index) ?? null;
}

/**
 * Show the card and wait for the user (max 30s).
 * Returns {decision:"allow"} | {decision:"deny"} | {decision:"deny_timeout"}.
 * Injection failures (no host permission on the tab, closed tab, …) also count
 * as a rejection — a confirmation we cannot display must never auto-approve.
 */
async function agxRunConfirmCard(tabId, summary) {
  try {
    const verdict = await agxInject(tabId, agxPageConfirmCard, [summary, AGX_CONFIRM_TIMEOUT_S]);
    const decision = verdict && typeof verdict.decision === "string" ? verdict.decision : "deny";
    if (decision === "allow") return { decision: "allow" };
    if (decision === "deny_timeout") return { decision: "deny_timeout" };
    return { decision: "deny" };
  } catch (err) {
    return { decision: "deny", inject_failed: String(err?.message ?? err) };
  }
}
