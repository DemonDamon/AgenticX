// SP3 · interact executors — click / type / press_key on the active tab.
//
// click/type resolve the element by the snapshot index: the index is validated
// against the chrome.storage.session snapshot cache first (fast stale_index),
// then the page-side data-near-agent-idx attribute left by the snapshot
// collector locates the actual element — including elements inside open
// shadow roots (the deep finder recurses where document.querySelector cannot).
//
// The page functions port desktop/src/components/work-panel/browser-agent-
// actions.ts (browserAgentClickJs / browserAgentTypeJs / browserAgentPressKeyJs)
// so agent-visible semantics stay identical: focus+click; the native value
// setter (React-controlled inputs) + input/change events; Enter trio +
// form.requestSubmit on submit; KeyboardEvent trio on the active element.
//
// NOTE: chrome.scripting serializes ONLY the passed func — every page function
// below is self-contained (the shadow-root deep finder is inlined per function,
// mirroring the browser-agent-actions.ts template-string pattern).
//
// Author: Damon Li

/** click page function (self-contained — serialized into the page world). */
function agxPageClickByIndex(index) {
  const selector = `[data-near-agent-idx="${index}"]`;
  const search = (root) => {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        const found = search(el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };
  const el = search(document.body || document.documentElement);
  if (!el) {
    return {
      ok: false,
      error: "stale_index",
      hint: "页面已变化，请重新 snapshot",
      url: location.href,
      title: document.title || "",
    };
  }
  el.focus();
  el.click();
  return { ok: true, url: location.href, title: document.title || "" };
}

/** type page function (self-contained — serialized into the page world). */
function agxPageTypeByIndex(index, text, submit) {
  const selector = `[data-near-agent-idx="${index}"]`;
  const search = (root) => {
    const direct = root.querySelector(selector);
    if (direct) return direct;
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) {
        const found = search(el.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };
  const el = search(document.body || document.documentElement);
  if (!el) {
    return {
      ok: false,
      error: "stale_index",
      hint: "页面已变化，请重新 snapshot",
      url: location.href,
      title: document.title || "",
    };
  }
  el.focus();
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc && desc.set) {
    desc.set.call(el, text); // native setter — React-controlled inputs stay in sync
  } else if ("value" in el) {
    el.value = text;
  } else if (el.isContentEditable) {
    el.textContent = text;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (submit) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", bubbles: true, cancelable: true }));
    }
    if (el.form && typeof el.form.requestSubmit === "function") {
      try {
        el.form.requestSubmit();
      } catch (err) {
        /* ignore */
      }
    }
  }
  return { ok: true, url: location.href, title: document.title || "" };
}

/** press_key page function (self-contained — serialized into the page world). */
function agxPagePressKey(key) {
  const target = document.activeElement || document.body;
  for (const type of ["keydown", "keypress", "keyup"]) {
    target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  }
  return { ok: true, url: location.href, title: document.title || "" };
}

// ---------------------------------------------------------------------------
// SW-side executors
// ---------------------------------------------------------------------------

async function executeClick(action, message) {
  const index = Number(message?.index);
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, action, error: "invalid_index" };
  }
  const guard = await agxResolveIndexedTarget(index);
  if (guard.error) {
    return { ok: false, action, ...guard.error };
  }
  const result = await agxInject(guard.tab.id, agxPageClickByIndex, [index]);
  if (result.ok !== true) {
    return { ok: false, action, ...result };
  }
  return {
    ok: true,
    action,
    url: String(result.url ?? ""),
    title: String(result.title ?? ""),
    backend: "extension",
  };
}

async function executeType(action, message) {
  const index = Number(message?.index);
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, action, error: "invalid_index" };
  }
  const text = String(message?.text ?? "");
  const submit = message?.submit === true;
  const guard = await agxResolveIndexedTarget(index);
  if (guard.error) {
    return { ok: false, action, ...guard.error };
  }
  const result = await agxInject(guard.tab.id, agxPageTypeByIndex, [index, text, submit]);
  if (result.ok !== true) {
    return { ok: false, action, ...result };
  }
  return {
    ok: true,
    action,
    url: String(result.url ?? ""),
    title: String(result.title ?? ""),
    backend: "extension",
  };
}

async function executePressKey(action, message) {
  const key = String(message?.key ?? "").trim();
  if (!key) {
    return { ok: false, action, error: "missing_key" };
  }
  const tab = await agxGetActiveTab();
  const result = await agxInject(tab.id, agxPagePressKey, [key]);
  return {
    ok: true,
    action,
    url: String(result.url ?? ""),
    title: String(result.title ?? ""),
    backend: "extension",
  };
}
