// SP3 · executor entry point — action dispatch + preActionHook.
//
// sw.js calls executeAction(message) for every {type:"act"} request that is
// NOT pinned to the SP2 stub (message.stub === true keeps executor-stub.js,
// the bridge forwards AGX_EXT_STUB=1 as that flag). Every action rides the
// SP2 pending/settle pipeline: the reply goes back only as
// {type:"act_result", ...result, request_id} — the extension never talks to
// the agent side directly.
//
// Return contract (SP3 plan §1.2, consumed by agent_tools.py
// _format_near_browser_result):
//   success  {ok:true, action, url, ...}   (confirmed actions add confirmed:true)
//   error    {ok:false, error:"..."}
//   blocked  {ok:false, error:"blocked: sensitive domain", domain, blocked:true}
//   declined {ok:false, error:"user_declined", confirm_outcome}
//
// SP4: preActionHook is now the safety layer (sensitive-domain default-deny +
// high-risk confirm card). It runs BEFORE the action touches the page; a
// verdict {block:true, error, ...} rejects, {confirmed:true} lets the action
// proceed and is merged into its result.
//
// Author: Damon Li

/**
 * SP4 safety gate — sensitive-domain default-deny first, then the high-risk
 * confirm card. `open` is judged by its target URL; every other action is
 * judged by the active tab (the page it would act on).
 */
async function preActionHook(action, target) {
  if (action !== "open") {
    try {
      const tab = await agxGetActiveTab();
      target = { ...target, tab_url: tab.url, tab_id: tab.id };
    } catch (err) {
      // No active tab: the executor surfaces its own error; nothing to guard.
    }
  }

  // 1. sensitive-domain default deny (extension = last line of defense)
  const domainVerdict = await agxSensitiveDomainVerdict(action, target);
  if (domainVerdict) {
    return {
      block: true,
      blocked: true,
      error: "blocked: sensitive domain",
      domain: domainVerdict.domain,
      category: domainVerdict.category,
      tab_url: domainVerdict.tab_url,
    };
  }

  // 2. high-risk confirm card (password type / form-submit click / Enter in form)
  const confirm = await agxConfirmRequired(action, target);
  if (!confirm) return null;
  const decision = await agxRunConfirmCard(confirm.tabId, confirm.summary);
  if (decision.decision === "allow") {
    return { confirmed: true, confirm_outcome: "allow", reason: confirm.reason };
  }
  return {
    block: true,
    error: "user_declined",
    hint:
      decision.decision === "deny_timeout"
        ? "确认卡片 30 秒无响应，已按拒绝处理"
        : "用户在确认卡片上拒绝了该操作",
    confirm_outcome: decision.decision,
    reason: confirm.reason,
    tab_url: target?.tab_url,
  };
}

async function executeAction(message) {
  const action = message?.action;
  const target = {
    url: message?.url,
    index: message?.index,
    text: message?.text,
    key: message?.key,
    query: message?.query,
  };
  try {
    const verdict = await preActionHook(action, target);
    if (verdict && verdict.block === true) {
      const result = {
        ok: false,
        action,
        error: String(verdict.error || "human_takeover"),
      };
      if (verdict.hint) result.hint = verdict.hint;
      if (verdict.blocked === true) result.blocked = true;
      if (verdict.domain) result.domain = verdict.domain;
      if (verdict.category) result.category = verdict.category;
      if (verdict.tab_url) result.tab_url = verdict.tab_url;
      if (verdict.confirm_outcome) result.confirm_outcome = verdict.confirm_outcome;
      if (verdict.reason) result.confirm_reason = verdict.reason;
      return result;
    }
    const result = await dispatchAction(action, message);
    if (verdict && verdict.confirmed === true && result && typeof result === "object") {
      result.confirmed = true;
      result.confirm_reason = verdict.reason;
    }
    return result;
  } catch (err) {
    const error = String(err?.message ?? err);
    return { ok: false, action, error };
  }
}

/** The SP3 dispatch — unchanged action semantics, now behind the safety gate. */
async function dispatchAction(action, message) {
  switch (action) {
    case "open":
      return await executeOpen(action, message);
    case "snapshot":
      return await executeSnapshot(action);
    case "click":
      return await executeClick(action, message);
    case "type":
      return await executeType(action, message);
    case "press_key":
      return await executePressKey(action, message);
    case "extract_text":
      return await executeExtractText(action, message);
    case "screenshot":
      return await executeScreenshot(action);
    default:
      return { ok: false, action, error: `unknown_action:${action}` };
  }
}
