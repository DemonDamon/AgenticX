export type BrowserAgentElement = {
  index: number;
  tag: string;
  type: string;
  text: string;
  placeholder: string;
  href: string;
  value_len: number;
  is_password: boolean;
};

export type BrowserAgentResult = {
  ok: boolean;
  error?: string;
  hint?: string;
  url?: string;
  title?: string;
  elements?: BrowserAgentElement[];
  path?: string;
  text?: string;
  request_id?: string;
};

function clipText(raw: unknown, max = 120): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export const BROWSER_AGENT_INDEX_JS = `(() => {
  const nodes = Array.from(document.querySelectorAll(
    'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [contenteditable=true]'
  ));
  const elements = [];
  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    const position = style.position;
    if (el.offsetParent === null && position !== "fixed" && position !== "sticky") continue;
    const index = elements.length;
    el.dataset.nearAgentIdx = String(index);
    const type = (el.getAttribute("type") || "").toLowerCase();
    const text = (el.innerText || el.value || el.getAttribute("placeholder") || el.getAttribute("aria-label") || "")
      .replace(/\\s+/g, " ")
      .trim()
      .slice(0, 120);
    elements.push({
      index,
      tag: (el.tagName || "").toLowerCase(),
      type,
      text,
      placeholder: el.getAttribute("placeholder") || "",
      href: el.getAttribute("href") || "",
      value_len: typeof el.value === "string" ? el.value.length : 0,
      is_password: type === "password",
    });
  }
  return JSON.stringify({
    ok: true,
    url: location.href,
    title: document.title || "",
    elements,
  });
})()`;

/** Guest script: visible text plus open shadow roots and same-origin iframes. */
export const BROWSER_AGENT_COLLECT_TEXT_FN = `function nearCollectVisibleText(root) {
  if (!root) return "";
  const chunks = [];
  const direct = (root.innerText || root.textContent || "");
  if (direct) chunks.push(direct);
  const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
  for (const el of nodes) {
    if (el.shadowRoot) chunks.push(nearCollectVisibleText(el.shadowRoot));
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "IFRAME" || tag === "FRAME") {
      try {
        const doc = el.contentDocument;
        if (doc) chunks.push(nearCollectVisibleText(doc.body || doc.documentElement));
      } catch (e) { /* cross-origin */ }
    }
  }
  return chunks.join("\\n");
}
function nearNormalizeExtract(raw, maxLen) {
  const lines = String(raw || "").split(/\\n+/).map((line) => line.replace(/[ \\t]+/g, " ").trim()).filter(Boolean);
  return lines.join("\\n").slice(0, maxLen || 24000);
}`;

export const BROWSER_AGENT_EXTRACT_JS = `(() => {
  ${BROWSER_AGENT_COLLECT_TEXT_FN}
  const text = nearNormalizeExtract(nearCollectVisibleText(document.body || document.documentElement), 24000);
  return JSON.stringify({
    ok: true,
    url: location.href,
    title: document.title || "",
    text,
  });
})()`;

export function browserAgentClickJs(index: number): string {
  return `(() => {
    const index = ${JSON.stringify(index)};
    const el = document.querySelector('[data-near-agent-idx="' + index + '"]');
    if (!el) {
      return JSON.stringify({
        ok: false,
        error: "stale_index",
        hint: "页面已变化，请重新 snapshot",
        url: location.href,
        title: document.title || "",
      });
    }
    el.focus();
    el.click();
    return JSON.stringify({
      ok: true,
      url: location.href,
      title: document.title || "",
    });
  })()`;
}

export function browserAgentTypeJs(index: number, text: string, submit = false): string {
  return `(() => {
    const index = ${JSON.stringify(index)};
    const text = ${JSON.stringify(text)};
    const submit = ${submit ? "true" : "false"};
    const el = document.querySelector('[data-near-agent-idx="' + index + '"]');
    if (!el) {
      return JSON.stringify({
        ok: false,
        error: "stale_index",
        hint: "页面已变化，请重新 snapshot",
        url: location.href,
        title: document.title || "",
      });
    }
    el.focus();
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
      desc.set.call(el, text);
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
        try { el.form.requestSubmit(); } catch (e) { /* ignore */ }
      }
    }
    return JSON.stringify({
      ok: true,
      url: location.href,
      title: document.title || "",
    });
  })()`;
}

export function browserAgentPressKeyJs(key: string): string {
  return `(() => {
    const key = ${JSON.stringify(key)};
    const target = document.activeElement || document.body;
    for (const type of ["keydown", "keypress", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, { key: key, bubbles: true, cancelable: true }));
    }
    return JSON.stringify({
      ok: true,
      url: location.href,
      title: document.title || "",
    });
  })()`;
}

export function browserAgentExtractJs(query?: string): string {
  const q = String(query || "").trim();
  if (!q) return BROWSER_AGENT_EXTRACT_JS;
  return `(() => {
    ${BROWSER_AGENT_COLLECT_TEXT_FN}
    const query = ${JSON.stringify(q)}.toLowerCase();
    const raw = nearNormalizeExtract(nearCollectVisibleText(document.body || document.documentElement), 24000);
    const lines = raw.split(/\\n+/).map((line) => line.trim()).filter(Boolean);
    const hits = lines.filter((line) => line.toLowerCase().includes(query)).slice(0, 80);
    const text = hits.length ? hits.join("\\n") : raw;
    return JSON.stringify({
      ok: true,
      url: location.href,
      title: document.title || "",
      text,
    });
  })()`;
}

export function filterExtractedText(raw: string, query?: string): string {
  const text = String(raw || "").trim();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return text.slice(0, 24000);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const hits = lines.filter((line) => line.toLowerCase().includes(q)).slice(0, 80);
  return (hits.length ? hits.join("\n") : text).slice(0, 24000);
}

function parseElement(raw: unknown, index: number): BrowserAgentElement | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  return {
    index: typeof row.index === "number" ? row.index : index,
    tag: clipText(row.tag, 40),
    type: clipText(row.type, 40),
    text: clipText(row.text),
    placeholder: clipText(row.placeholder),
    href: clipText(row.href, 300),
    value_len: typeof row.value_len === "number" ? row.value_len : 0,
    is_password: row.is_password === true,
  };
}

export function parseBrowserAgentResult(raw: unknown): BrowserAgentResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return { ok: false, error: "empty_result" };
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "invalid_result" };
  }
  const row = value as Record<string, unknown>;
  const elements = Array.isArray(row.elements)
    ? row.elements
        .map((item, index) => parseElement(item, index))
        .filter((item): item is BrowserAgentElement => item != null)
    : undefined;
  return {
    ok: row.ok !== false && !row.error,
    error: row.error != null ? String(row.error) : undefined,
    hint: row.hint != null ? String(row.hint) : undefined,
    url: row.url != null ? String(row.url) : undefined,
    title: row.title != null ? String(row.title) : undefined,
    elements,
    path: row.path != null ? String(row.path) : undefined,
    text: row.text != null ? String(row.text) : undefined,
    request_id: row.request_id != null ? String(row.request_id) : undefined,
  };
}
