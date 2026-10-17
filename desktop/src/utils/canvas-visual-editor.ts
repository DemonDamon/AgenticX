/**
 * Canvas visual editor bridge — Trae「可视化编辑器 ⌥3」对标。
 *
 * Injects an element-pick + live-style bridge into the sandboxed srcDoc frames
 * of the design canvas. The parent (DesignCanvasPanel) owns the edit state and
 * talks to the frame over postMessage; edits can be written back into the
 * source HTML file via applyEditsToHtmlSource.
 *
 * The iframe runs without allow-same-origin, so all selection/style work
 * happens inside this injected script; the parent only sees messages.
 *
 * Author: Damon Li
 */

export const CANVAS_EDITOR_MSG = "agx-canvas-editor" as const;
/** Bump when the injected bridge behavior changes so srcDoc re-injects. */
export const CANVAS_EDITOR_BRIDGE_VERSION = 1;

/** cssPath -> camelCase CSS prop -> value ("" removes the inline property). */
export type CanvasEditorStyleMap = Record<string, Record<string, string>>;

export type CanvasEditorRect = { top: number; left: number; width: number; height: number };

export type CanvasEditorSelectPayload = {
  cssPath: string;
  tagName: string;
  selectorHint: string;
  rect: CanvasEditorRect;
  computed: Record<string, string>;
  inline: Record<string, string>;
  /** ⌘/Ctrl + Click quick-select while the editor was disabled. */
  quick: boolean;
};

export type CanvasEditorParentMessage =
  | { type: typeof CANVAS_EDITOR_MSG; action: "set-enabled"; enabled: boolean }
  | { type: typeof CANVAS_EDITOR_MSG; action: "sync-styles"; styles: CanvasEditorStyleMap }
  | { type: typeof CANVAS_EDITOR_MSG; action: "reselect"; cssPath: string }
  | { type: typeof CANVAS_EDITOR_MSG; action: "clear-selection" };

export type CanvasEditorChildMessage =
  | { type: typeof CANVAS_EDITOR_MSG; action: "select"; payload: CanvasEditorSelectPayload }
  | { type: typeof CANVAS_EDITOR_MSG; action: "escape" }
  | { type: typeof CANVAS_EDITOR_MSG; action: "select-missing" };

/**
 * Editable form state for one element. translateX/translateY/rotate are
 * pseudo-props composed into `transform` by composeEditorStyle. Numeric
 * values are stored as unit-less strings (px / percent / deg).
 */
export type CanvasStyleEdits = {
  flexDirection?: string;
  marginTop?: string;
  marginRight?: string;
  marginBottom?: string;
  marginLeft?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  gap?: string;
  /** 0-100 (percent). */
  opacity?: string;
  borderRadius?: string;
  translateX?: string;
  translateY?: string;
  /** deg. */
  rotate?: string;
};

const BRIDGE_SCRIPT = `
(function(){
  if (window.__agxCanvasEditorInstalled === ${CANVAS_EDITOR_BRIDGE_VERSION}) return;
  window.__agxCanvasEditorInstalled = ${CANVAS_EDITOR_BRIDGE_VERSION};
  var MSG = "${CANVAS_EDITOR_MSG}";
  var enabled = false;
  var selected = null;
  var hovered = null;
  var hoverOv = null;
  var selectOv = null;
  var label = null;
  var applied = {};
  var raf = 0;

  var COMPUTED_PROPS = ["display","flexDirection","marginTop","marginRight","marginBottom","marginLeft","paddingTop","paddingRight","paddingBottom","paddingLeft","gap","opacity","borderTopLeftRadius","transform"];
  var INLINE_PROPS = ["display","flexDirection","marginTop","marginRight","marginBottom","marginLeft","paddingTop","paddingRight","paddingBottom","paddingLeft","gap","opacity","borderRadius","transform"];

  function kebab(prop){ return prop.replace(/[A-Z]/g, function(c){ return "-" + c.toLowerCase(); }); }

  function ensureUi(){
    if (hoverOv) return;
    hoverOv = document.createElement("div");
    hoverOv.setAttribute("data-agx-editor", "hover");
    hoverOv.style.cssText = "position:fixed;pointer-events:none;z-index:2147483645;border:1.5px dashed rgba(59,130,246,0.9);box-sizing:border-box;display:none;";
    selectOv = document.createElement("div");
    selectOv.setAttribute("data-agx-editor", "select");
    selectOv.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #16a34a;background:rgba(22,163,74,0.06);box-sizing:border-box;display:none;";
    label = document.createElement("div");
    label.setAttribute("data-agx-editor", "label");
    label.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;background:#15803d;color:#fff;font:11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;padding:2px 8px;border-radius:999px;white-space:nowrap;display:none;";
    document.documentElement.appendChild(hoverOv);
    document.documentElement.appendChild(selectOv);
    document.documentElement.appendChild(label);
  }

  function paint(ov, el){
    var r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0){ ov.style.display = "none"; return r; }
    ov.style.display = "block";
    ov.style.top = r.top + "px";
    ov.style.left = r.left + "px";
    ov.style.width = Math.max(0, r.width) + "px";
    ov.style.height = Math.max(0, r.height) + "px";
    return r;
  }

  function paintSelected(){
    if (!selected) return;
    if (selected.isConnected === false){ clearSelection(); return; }
    var r = paint(selectOv, selected);
    if (!r) return;
    label.style.display = "block";
    label.textContent = tagOf(selected);
    label.style.top = Math.max(4, r.top - 22) + "px";
    label.style.left = Math.max(4, r.left) + "px";
  }

  function isChrome(el){ return !!(el && el.getAttribute && el.getAttribute("data-agx-editor")); }
  function tagOf(el){ return String(el && el.tagName ? el.tagName : "node").toLowerCase(); }

  function pick(clientX, clientY){
    var el = document.elementFromPoint(clientX, clientY);
    if (!el || isChrome(el) || el === document.documentElement || el === document.body) return null;
    return el;
  }

  function cssPathOf(el){
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur === document.documentElement) { parts.unshift("html"); break; }
      var parent = cur.parentElement;
      if (!parent) { parts.unshift(tagOf(cur)); break; }
      var idx = 0;
      var kids = parent.children;
      for (var i = 0; i < kids.length; i++){
        if (kids[i].tagName === cur.tagName) idx++;
        if (kids[i] === cur) break;
      }
      parts.unshift(tagOf(cur) + ":nth-of-type(" + idx + ")");
      cur = parent;
    }
    return parts.join(" > ");
  }

  function selectorHint(el){
    var tag = tagOf(el);
    if (el.id) return tag + "#" + el.id;
    var cls = "";
    if (el.className && typeof el.className === "string") {
      cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2).join(".");
    }
    return cls ? tag + "." + cls : tag;
  }

  function styleReport(el){
    var cs = getComputedStyle(el);
    var computed = {};
    for (var i = 0; i < COMPUTED_PROPS.length; i++){
      var p = COMPUTED_PROPS[i];
      computed[p] = String(cs[p] == null ? "" : cs[p]);
    }
    var inline = {};
    for (var j = 0; j < INLINE_PROPS.length; j++){
      var q = INLINE_PROPS[j];
      inline[q] = el.style[q] || "";
    }
    return { computed: computed, inline: inline };
  }

  function post(payload){
    try { parent.postMessage(Object.assign({ type: MSG }, payload), "*"); } catch (e) {}
  }

  function doSelect(el, quick){
    selected = el;
    hovered = null;
    ensureUi();
    if (hoverOv) hoverOv.style.display = "none";
    var r = el.getBoundingClientRect();
    paintSelected();
    var rep = styleReport(el);
    post({ action: "select", payload: {
      cssPath: cssPathOf(el),
      tagName: tagOf(el),
      selectorHint: selectorHint(el),
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      computed: rep.computed,
      inline: rep.inline,
      quick: !!quick
    }});
  }

  function clearSelection(){
    selected = null;
    if (selectOv) selectOv.style.display = "none";
    if (label) label.style.display = "none";
  }

  function findByPath(path){
    try { return document.querySelector(path); } catch (e) { return null; }
  }

  function applyOne(cssPath, style){
    var prev = applied[cssPath] || {};
    var el = findByPath(cssPath);
    if (!el) { delete applied[cssPath]; return; }
    var next = {};
    var keys = Object.keys(style || {});
    for (var i = 0; i < keys.length; i++){
      var prop = keys[i];
      var val = style[prop];
      var kp = kebab(prop);
      if (val === "" || val == null) { el.style.removeProperty(kp); }
      else { el.style[prop] = val; next[kp] = true; }
    }
    var prevKeys = Object.keys(prev);
    for (var j = 0; j < prevKeys.length; j++){
      var old = prevKeys[j];
      if (!next[old]) el.style.removeProperty(old);
    }
    if (Object.keys(next).length) applied[cssPath] = next; else delete applied[cssPath];
    if (selected && el === selected) paintSelected();
  }

  window.addEventListener("message", function(ev){
    var d = ev && ev.data;
    if (!d || d.type !== MSG) return;
    if (d.action === "set-enabled"){
      enabled = !!d.enabled;
      if (!enabled){
        clearSelection();
        hovered = null;
        if (hoverOv) hoverOv.style.display = "none";
        document.documentElement.style.cursor = "";
      } else {
        ensureUi();
        document.documentElement.style.cursor = "crosshair";
      }
      return;
    }
    if (d.action === "sync-styles"){
      var styles = d.styles || {};
      var paths = Object.keys(styles);
      for (var i = 0; i < paths.length; i++) applyOne(paths[i], styles[paths[i]]);
      var appliedPaths = Object.keys(applied);
      for (var j = 0; j < appliedPaths.length; j++){
        var p = appliedPaths[j];
        if (!styles[p]) {
          var stale = findByPath(p);
          if (stale) {
            var props = Object.keys(applied[p]);
            for (var k = 0; k < props.length; k++) stale.style.removeProperty(props[k]);
          }
          delete applied[p];
        }
      }
      return;
    }
    if (d.action === "reselect"){
      var el2 = findByPath(d.cssPath || "");
      if (el2 && enabled) doSelect(el2, false);
      else post({ action: "select-missing" });
      return;
    }
    if (d.action === "clear-selection"){ clearSelection(); }
  });

  document.addEventListener("mousemove", function(e){
    if (!enabled) return;
    var el = pick(e.clientX, e.clientY);
    if (!el || el === selected){
      if (!el && hoverOv) hoverOv.style.display = "none";
      hovered = null;
      return;
    }
    hovered = el;
    ensureUi();
    paint(hoverOv, el);
  }, true);

  document.addEventListener("mousedown", function(e){
    if (enabled || e.metaKey || e.ctrlKey) e.preventDefault();
  }, true);

  document.addEventListener("click", function(e){
    var quick = !enabled && (e.metaKey || e.ctrlKey);
    if (!enabled && !quick) return;
    e.preventDefault();
    e.stopPropagation();
    var el = pick(e.clientX, e.clientY);
    if (!el) return;
    doSelect(el, quick);
  }, true);

  document.addEventListener("keydown", function(e){
    if (!enabled) return;
    if (e.key === "Escape"){
      clearSelection();
      post({ action: "escape" });
    }
  }, true);

  function scheduleRepaint(){
    if (raf) return;
    raf = requestAnimationFrame(function(){
      raf = 0;
      if (selected) paintSelected();
      else if (enabled && hovered && hovered.isConnected !== false) { ensureUi(); paint(hoverOv, hovered); }
      else if (hoverOv) hoverOv.style.display = "none";
    });
  }
  window.addEventListener("scroll", scheduleRepaint, true);
  window.addEventListener("resize", scheduleRepaint);
})();
`.trim();

const EDITOR_SCRIPT_TAG_RE =
  /<script\b[^>]*>[\s\S]*?__agxCanvasEditorInstalled[\s\S]*?<\/script>/gi;

/** Append the editor bridge as a trailing script so it runs after document parse. */
export function injectCanvasEditorBridge(html: string): string {
  let src = String(html ?? "");
  if (!src) {
    return `<!DOCTYPE html><html><head></head><body><script>${BRIDGE_SCRIPT}</script></body></html>`;
  }
  const versionMark = `__agxCanvasEditorInstalled = ${CANVAS_EDITOR_BRIDGE_VERSION}`;
  if (src.includes("__agxCanvasEditorInstalled")) {
    if (src.includes(versionMark)) return src;
    src = src.replace(EDITOR_SCRIPT_TAG_RE, "");
  }
  const snippet = `<script>${BRIDGE_SCRIPT}</script>`;
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

export function isCanvasEditorChildMessage(data: unknown): data is CanvasEditorChildMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as { type?: unknown; action?: unknown };
  if (d.type !== CANVAS_EDITOR_MSG) return false;
  return d.action === "select" || d.action === "escape" || d.action === "select-missing";
}

/** Compose element edits into concrete CSS props (pseudo-props -> transform). */
export function composeEditorStyle(edits: CanvasStyleEdits): Record<string, string> {
  const out: Record<string, string> = {};
  const pxKeys = [
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "gap",
    "borderRadius",
  ] as const;
  for (const key of pxKeys) {
    const value = edits[key];
    if (value !== undefined && value !== "") out[key] = `${value}px`;
  }
  if (edits.flexDirection) out.flexDirection = edits.flexDirection;
  if (edits.opacity !== undefined && edits.opacity !== "") {
    const pct = Number(edits.opacity);
    if (Number.isFinite(pct)) out.opacity = String(Math.min(100, Math.max(0, pct)) / 100);
  }
  const tx = edits.translateX;
  const ty = edits.translateY;
  const rot = edits.rotate;
  if (tx !== undefined || ty !== undefined || rot !== undefined) {
    const x = Number(tx || 0);
    const y = Number(ty || 0);
    const r = Number(rot || 0);
    if (x || y || r) out.transform = `translate(${x}px, ${y}px) rotate(${r}deg)`;
  }
  return out;
}

/** "12.5px" -> "12.5"; "0px" -> "0"; garbage -> "". */
export function parsePx(value: string | undefined | null): string {
  if (!value) return "";
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

/** Decompose a computed 2D matrix() into translate/rotate parts for the panel. */
export function parseMatrixTransform(value: string | undefined | null): {
  x: string;
  y: string;
  rotate: string;
} {
  const empty = { x: "", y: "", rotate: "" };
  if (!value || value === "none") return empty;
  const match = /matrix\(([^)]+)\)/.exec(value);
  if (!match) return empty;
  const parts = match[1].split(",").map((s) => parseFloat(s.trim()));
  if (parts.length < 6 || parts.some((n) => !Number.isFinite(n))) return empty;
  const [a, b, , , tx, ty] = parts;
  const rot = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return {
    x: tx ? String(Math.round(tx)) : "",
    y: ty ? String(Math.round(ty)) : "",
    rotate: rot ? String(rot) : "",
  };
}

/**
 * Write style edits back into raw HTML source: locate each element by its
 * cssPath (nth-of-type chain) and merge the props into its inline style.
 */
export function applyEditsToHtmlSource(source: string, styles: CanvasEditorStyleMap): string {
  const doc = new DOMParser().parseFromString(source, "text/html");
  for (const [cssPath, style] of Object.entries(styles)) {
    let el: Element | null = null;
    try {
      el = doc.querySelector(cssPath);
    } catch {
      el = null;
    }
    if (!el || !(el instanceof HTMLElement)) continue;
    for (const [prop, value] of Object.entries(style)) {
      const kebab = prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      if (value === "") el.style.removeProperty(kebab);
      else el.style.setProperty(kebab, value);
    }
  }
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}
