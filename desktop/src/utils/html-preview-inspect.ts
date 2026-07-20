/**
 * Inject a select-element / outline bridge into local HTML srcDoc previews.
 * Runs inside the sandboxed iframe (no allow-same-origin); talks to parent via postMessage.
 */

export const HTML_INSPECT_MSG = "agx-html-inspect" as const;
export const HTML_ELEMENT_OUTER_HTML_MAX = 8000;
/** Bump when the injected bridge behavior changes so srcDoc re-injects. */
export const HTML_INSPECT_BRIDGE_VERSION = 3;

export type HtmlInspectRect = { top: number; left: number; width: number; height: number };

export type HtmlInspectParentMessage =
  | { type: typeof HTML_INSPECT_MSG; action: "set-enabled"; enabled: boolean }
  | { type: typeof HTML_INSPECT_MSG; action: "clear-selection" };

export type HtmlInspectChildMessage =
  | {
      type: typeof HTML_INSPECT_MSG;
      action: "hover";
      tagName: string;
      rect: HtmlInspectRect;
    }
  | {
      type: typeof HTML_INSPECT_MSG;
      action: "select";
      tagName: string;
      selectorHint: string;
      outerHTML: string;
      innerText: string;
      rect: HtmlInspectRect;
    }
  /** Selection still active; element moved (scroll/resize) — update overlay + parent popover. */
  | {
      type: typeof HTML_INSPECT_MSG;
      action: "rect-update";
      rect: HtmlInspectRect;
    }
  | { type: typeof HTML_INSPECT_MSG; action: "leave" }
  | { type: typeof HTML_INSPECT_MSG; action: "escape" };

export type HtmlElementSelection = {
  tagName: string;
  selectorHint: string;
  outerHTML: string;
  innerText: string;
  rect: HtmlInspectRect;
};

const INSPECT_SCRIPT = `
(function(){
  if (window.__agxHtmlInspectInstalled === ${HTML_INSPECT_BRIDGE_VERSION}) return;
  window.__agxHtmlInspectInstalled = ${HTML_INSPECT_BRIDGE_VERSION};
  var MSG = "${HTML_INSPECT_MSG}";
  var MAX_HTML = ${HTML_ELEMENT_OUTER_HTML_MAX};
  var enabled = false;
  var selected = null;
  var hovered = null;
  var lastPtrX = 0;
  var lastPtrY = 0;
  var hasPtr = false;
  var overlay = null;
  var label = null;

  function ensureUi() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.setAttribute("data-agx-inspect", "overlay");
    overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #16a34a;background:rgba(22,163,74,0.08);display:none;box-sizing:border-box;";
    label = document.createElement("div");
    label.setAttribute("data-agx-inspect", "label");
    label.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;background:#15803d;color:#fff;font:11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;padding:2px 8px;border-radius:999px;display:none;white-space:nowrap;";
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(label);
  }

  function hideHover() {
    if (!overlay || selected) return;
    hovered = null;
    overlay.style.display = "none";
    if (label) label.style.display = "none";
  }

  function paint(el, tag) {
    ensureUi();
    if (!el || !overlay || !label) return;
    var r = el.getBoundingClientRect();
    // Element scrolled out of view — hide chrome until it returns.
    if (r.width <= 0 && r.height <= 0) {
      overlay.style.display = "none";
      label.style.display = "none";
      return r;
    }
    overlay.style.display = "block";
    overlay.style.top = r.top + "px";
    overlay.style.left = r.left + "px";
    overlay.style.width = Math.max(0, r.width) + "px";
    overlay.style.height = Math.max(0, r.height) + "px";
    label.style.display = "block";
    label.textContent = tag;
    var ly = Math.max(4, r.top - 22);
    var lx = Math.max(4, r.left);
    label.style.top = ly + "px";
    label.style.left = lx + "px";
    return r;
  }

  function pickHoverTarget(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    if (!el || isInspectChrome(el) || el === document.documentElement || el === document.body) {
      return null;
    }
    return el;
  }

  var syncRaf = 0;
  /** Re-pin overlay after scroll/wheel — covers both selection and hover (mousemove does not fire on scroll). */
  function syncOverlayToScroll() {
    if (!enabled) return;
    if (selected) {
      if (selected.isConnected === false) {
        selected = null;
        hideHover();
        return;
      }
      var stag = tagOf(selected);
      var sr = paint(selected, stag);
      if (!sr) return;
      post({
        action: "rect-update",
        rect: { top: sr.top, left: sr.left, width: sr.width, height: sr.height }
      });
      return;
    }
    var el = null;
    if (hasPtr) el = pickHoverTarget(lastPtrX, lastPtrY);
    if (!el && hovered && hovered.isConnected !== false) el = hovered;
    if (!el) {
      hideHover();
      post({ action: "leave" });
      return;
    }
    hovered = el;
    var tag = tagOf(el);
    var r = paint(el, tag);
    if (!r) return;
    post({
      action: "hover",
      tagName: tag,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height }
    });
  }

  function scheduleSyncOverlay() {
    if (!enabled) return;
    if (syncRaf) return;
    syncRaf = requestAnimationFrame(function() {
      syncRaf = 0;
      syncOverlayToScroll();
    });
  }

  function isInspectChrome(el) {
    return !!(el && el.getAttribute && el.getAttribute("data-agx-inspect"));
  }

  function tagOf(el) {
    return String(el && el.tagName ? el.tagName : "node").toLowerCase();
  }

  function selectorHint(el) {
    if (!el || !el.tagName) return "";
    var tag = tagOf(el);
    if (el.id) return tag + "#" + el.id;
    var cls = "";
    if (el.className && typeof el.className === "string") {
      cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
    } else if (el.classList && el.classList.length) {
      cls = Array.prototype.slice.call(el.classList, 0, 2).join(".");
    }
    return cls ? tag + "." + cls : tag;
  }

  function clipHtml(raw) {
    var s = String(raw || "");
    if (s.length <= MAX_HTML) return s;
    return s.slice(0, MAX_HTML) + "\\n<!-- truncated -->";
  }

  function collectText(el) {
    try {
      return String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    } catch (err) {
      return "";
    }
  }

  function isSvgGeometry(el) {
    var t = tagOf(el);
    return t === "rect" || t === "path" || t === "circle" || t === "ellipse"
      || t === "polygon" || t === "line" || t === "polyline" || t === "use";
  }

  /** Mermaid/SVG: clicked rect often has no text — climb to parent g/cluster with labels. */
  function promoteForContent(el) {
    var best = el;
    var bestText = collectText(el);
    var cur = el;
    for (var i = 0; i < 10 && cur && cur.parentElement; i++) {
      var parent = cur.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;
      var pt = collectText(parent);
      var ptag = tagOf(parent);
      if (pt.length > bestText.length) {
        best = parent;
        bestText = pt;
      }
      if (parent.classList && (parent.classList.contains("mermaid") || parent.id === "mermaid-chart")) {
        break;
      }
      if ((ptag === "g" || ptag === "svg" || ptag === "div" || ptag === "section") && bestText.length >= 6) {
        if (!isSvgGeometry(el) || ptag === "g") break;
      }
      cur = parent;
    }
    return { el: best, text: bestText };
  }

  function post(payload) {
    try { parent.postMessage(Object.assign({ type: MSG }, payload), "*"); } catch (e) {}
  }

  window.addEventListener("message", function(ev) {
    var d = ev && ev.data;
    if (!d || d.type !== MSG) return;
    if (d.action === "set-enabled") {
      enabled = !!d.enabled;
      if (!enabled) {
        selected = null;
        hovered = null;
        if (overlay) overlay.style.display = "none";
        if (label) label.style.display = "none";
        document.documentElement.style.cursor = "";
      } else {
        document.documentElement.style.cursor = "crosshair";
        ensureUi();
      }
      return;
    }
    if (d.action === "clear-selection") {
      selected = null;
      if (overlay) overlay.style.display = "none";
      if (label) label.style.display = "none";
      hovered = null;
    }
  });

  document.addEventListener("mousemove", function(e) {
    if (!enabled) return;
    lastPtrX = e.clientX;
    lastPtrY = e.clientY;
    hasPtr = true;
    var el = pickHoverTarget(e.clientX, e.clientY);
    if (!el) {
      if (!selected) hideHover();
      post({ action: "leave" });
      return;
    }
    if (selected && el === selected) return;
    if (selected) return;
    hovered = el;
    var tag = tagOf(el);
    paint(el, tag);
    var r = el.getBoundingClientRect();
    post({ action: "hover", tagName: tag, rect: { top: r.top, left: r.left, width: r.width, height: r.height } });
  }, true);

  document.addEventListener("click", function(e) {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    lastPtrX = e.clientX;
    lastPtrY = e.clientY;
    hasPtr = true;
    var el = pickHoverTarget(e.clientX, e.clientY);
    if (!el) return;
    selected = el;
    hovered = null;
    var paintTag = tagOf(el);
    paint(el, paintTag);
    var r = el.getBoundingClientRect();
    var promoted = promoteForContent(el);
    var contentEl = promoted.el || el;
    var text = (promoted.text || collectText(contentEl)).slice(0, 800);
    var tag = tagOf(contentEl);
    post({
      action: "select",
      tagName: tag,
      selectorHint: selectorHint(contentEl),
      outerHTML: clipHtml(contentEl.outerHTML || ""),
      innerText: text,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height }
    });
  }, true);

  document.addEventListener("keydown", function(e) {
    if (!enabled) return;
    if (e.key === "Escape") {
      enabled = false;
      selected = null;
      hovered = null;
      if (overlay) overlay.style.display = "none";
      if (label) label.style.display = "none";
      document.documentElement.style.cursor = "";
      post({ action: "escape" });
    }
  }, true);

  // position:fixed overlay is viewport-relative — re-pin on scroll/wheel/resize
  // (hover path too: wheel scroll does not fire mousemove).
  window.addEventListener("scroll", scheduleSyncOverlay, true);
  window.addEventListener("wheel", scheduleSyncOverlay, { capture: true, passive: true });
  window.addEventListener("resize", scheduleSyncOverlay);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleSyncOverlay);
    window.visualViewport.addEventListener("scroll", scheduleSyncOverlay);
  }
})();
`.trim();

const INSPECT_SCRIPT_TAG_RE =
  /<script\b[^>]*>[\s\S]*?__agxHtmlInspectInstalled[\s\S]*?<\/script>/gi;

/** Append inspect bridge as a trailing script so it runs after document parse. */
export function injectHtmlInspectBridge(html: string): string {
  let src = String(html ?? "");
  if (!src) {
    return `<!DOCTYPE html><html><head></head><body><script>${INSPECT_SCRIPT}</script></body></html>`;
  }
  // Drop stale bridge so scroll-pin / rect-update upgrades take effect.
  const versionMark = `__agxHtmlInspectInstalled = ${HTML_INSPECT_BRIDGE_VERSION}`;
  if (src.includes("__agxHtmlInspectInstalled") && !src.includes(versionMark)) {
    src = src.replace(INSPECT_SCRIPT_TAG_RE, "");
  }
  if (src.includes(versionMark) || src.includes(`__agxHtmlInspectInstalled === ${HTML_INSPECT_BRIDGE_VERSION}`)) {
    return src;
  }
  // Legacy inject without version equality — strip before re-adding.
  if (src.includes("__agxHtmlInspectInstalled") || src.includes(HTML_INSPECT_MSG)) {
    src = src.replace(INSPECT_SCRIPT_TAG_RE, "");
  }
  const snippet = `<script>${INSPECT_SCRIPT}</script>`;
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(src)) {
    return src.replace(bodyClose, `${snippet}</body>`);
  }
  const htmlClose = /<\/html\s*>/i;
  if (htmlClose.test(src)) {
    return src.replace(htmlClose, `${snippet}</html>`);
  }
  return `${src}${snippet}`;
}

export function isHtmlInspectChildMessage(data: unknown): data is HtmlInspectChildMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as { type?: unknown; action?: unknown };
  if (d.type !== HTML_INSPECT_MSG) return false;
  return (
    d.action === "hover" ||
    d.action === "select" ||
    d.action === "rect-update" ||
    d.action === "leave" ||
    d.action === "escape"
  );
}

/** Structured context block for /api/chat context_files so the model can edit the element. */
export function buildHtmlElementContextSnippet(opts: {
  absolutePath: string;
  tagName: string;
  selectorHint: string;
  outerHTML: string;
  innerText?: string;
  comment?: string;
}): string {
  const path = String(opts.absolutePath || "").trim();
  const tag = String(opts.tagName || "element").trim() || "element";
  const selector = String(opts.selectorHint || tag).trim() || tag;
  const text = String(opts.innerText || "").replace(/\s+/g, " ").trim().slice(0, 800);
  const comment = String(opts.comment || "").trim();
  const html = String(opts.outerHTML || "").trim();
  const looksSvg =
    /^svg$/i.test(tag) ||
    /^g$/i.test(tag) ||
    /<svg[\s>]/i.test(html) ||
    /<(?:rect|path|circle|text|tspan)\b/i.test(html);
  const lines = [
    "# Selected HTML element",
    `- path: ${path}`,
    `- tag: ${tag}`,
    `- selector: ${selector}`,
  ];
  if (text) {
    lines.push(`- visible_text: ${text}`);
  }
  if (comment) {
    lines.push(`- user_comment: ${comment}`);
  }
  lines.push(
    "",
    "The user referenced this concrete DOM node from the HTML preview (select-element).",
    "Do NOT give a generic HTML tag dictionary definition (e.g. what `<span>` means in general).",
    "Answer about THIS node using visible_text / outerHTML below.",
  );
  if (comment) {
    lines.push(
      `User question/comment about this element (Trae「评论到对话」): ${comment}`,
      "Treat `user_comment` as the primary user utterance for this turn."
    );
  }
  lines.push(
    "If they ask what this contains / 这里面内容是啥, answer from visible_text first (do not claim you cannot see it).",
    "When they ask to change name/text/style, edit the HTML file at `path` on disk.",
  );
  if (looksSvg) {
    lines.push(
      "Note: this may be a rendered Mermaid/SVG node. Diagram source usually lives in a `.mermaid` block in the same HTML file — read that file if you need the full flowchart text."
    );
  }
  lines.push(
    "",
    "Prefer locating the matching outerHTML (or visible_text) and replacing that node in place; keep the rest of the document unchanged.",
    "",
    "```html",
    html || `<!-- empty ${tag} -->`,
    "```"
  );
  return lines.join("\n");
}
