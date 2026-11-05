// SP3 · page-side DOM collectors for snapshot / extract_text.
//
// Ported from desktop/electron/browser-bridge.ts frameScript (L281-295, the
// shadow-DOM recursive innerText merge) and desktop/src/components/work-panel/
// browser-agent-actions.ts (BROWSER_AGENT_INDEX_JS element indexing +
// BROWSER_AGENT_COLLECT_TEXT_FN), adapted for chrome.scripting injection.
//
// IMPORTANT: every function below is stringified by chrome.scripting and run
// in the page's ISOLATED world — it must be fully self-contained (no outer
// references). DOM attributes (data-near-agent-idx) and element values are
// shared across worlds, so the main-world page handlers still observe them.
//
// Limitations (SP3 plan §2, deliberate):
//   - snapshot does NOT recurse into iframes — cross-origin frames are
//     unreachable without the chrome.debugger path (SP6); the desktop bridge
//     iterated frames from the main process, which an extension cannot.
//   - closed shadow roots are invisible (open shadow roots only).
//
// Author: Damon Li

/** snapshot collector: indexes every visible interactive element (including
 *  those inside open shadow roots) and returns the element list the agent
 *  prompt consumes: {index, tag, type, text, placeholder, href, value_len,
 *  is_password, in_form} plus the SP3 contract's role/aria-label/rect extras. */
function agxPageSnapshotCollector() {
  const SELECTOR =
    'a[href], button, input:not([type=hidden]), textarea, select, [role=button], [contenteditable=true]';
  const MAX_ELEMENTS = 400; // NM socket caps one message at 1MB — headroom, not a product limit
  const elements = [];

  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return null;
    }
    const position = style.position;
    if (el.offsetParent === null && position !== "fixed" && position !== "sticky") return null;
    return rect;
  };

  const describe = (el, index, rect) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    const text = (
      el.innerText ||
      el.value ||
      el.getAttribute("placeholder") ||
      el.getAttribute("aria-label") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    return {
      index,
      tag: (el.tagName || "").toLowerCase(),
      type,
      text,
      placeholder: el.getAttribute("placeholder") || "",
      href: el.getAttribute("href") || "",
      value_len: typeof el.value === "string" ? el.value.length : 0,
      is_password: type === "password",
      // SP4: click gating flags submit buttons and any button inside a form.
      in_form: !!(el.form || (el.closest && el.closest("form"))),
      role: el.getAttribute("role") || "",
      aria_label: el.getAttribute("aria-label") || "",
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  };

  const walk = (root) => {
    if (!root || !root.querySelectorAll) return;
    for (const el of root.querySelectorAll(SELECTOR)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
      const rect = visible(el);
      if (!rect) continue;
      const index = elements.length;
      el.dataset.nearAgentIdx = String(index); // page-side index cache click/type look up
      elements.push(describe(el, index, rect));
      if (elements.length >= MAX_ELEMENTS) return;
    }
    for (const el of root.querySelectorAll("*")) {
      if (elements.length >= MAX_ELEMENTS) return;
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };

  walk(document.body || document.documentElement);
  return {
    url: location.href,
    title: document.title || "",
    elements,
    truncated: elements.length >= MAX_ELEMENTS,
  };
}

/** extract_text collector: frameScript port — shadow-DOM recursive innerText
 *  merge, same-origin iframe text, line normalization, then the agent-side
 *  query filter (case-insensitive substring per line, ≤80 hits, fallback to
 *  the full text). 24000-char cap matches the embedded backend. */
function agxPageExtractCollector(query) {
  const collect = (root) => {
    if (!root) return "";
    const chunks = [];
    const direct = root.innerText || root.textContent || "";
    if (direct) chunks.push(direct);
    const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (const el of nodes) {
      if (el.shadowRoot) chunks.push(collect(el.shadowRoot));
      const tag = (el.tagName || "").toUpperCase();
      if (tag === "IFRAME" || tag === "FRAME") {
        try {
          const doc = el.contentDocument; // same-origin only; cross-origin throws
          if (doc) chunks.push(collect(doc.body || doc.documentElement));
        } catch (err) {
          /* cross-origin frame — unreachable without the debugger path */
        }
      }
    }
    return chunks.join("\n");
  };

  const normalize = (raw) =>
    String(raw || "")
      .split(/\n+/)
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");

  const full = normalize(collect(document.body || document.documentElement)).slice(0, 24000);
  let text = full;
  const q = String(query || "").trim().toLowerCase();
  if (q) {
    const hits = full
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().includes(q))
      .slice(0, 80);
    if (hits.length) text = hits.join("\n");
  }
  return { url: location.href, title: document.title || "", text };
}
