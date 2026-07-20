const HTML_PREVIEW_STORAGE_BRIDGE_MARK = "__agxHtmlPreviewStorageBridge";

const HTML_PREVIEW_STORAGE_BRIDGE = `
(function () {
  if (window.${HTML_PREVIEW_STORAGE_BRIDGE_MARK}) return;
  window.${HTML_PREVIEW_STORAGE_BRIDGE_MARK} = true;

  function createMemoryStorage() {
    var values = Object.create(null);

    return {
      get length() {
        return Object.keys(values).length;
      },
      key: function (index) {
        return Object.keys(values)[index] || null;
      },
      getItem: function (key) {
        var name = String(key);
        return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null;
      },
      setItem: function (key, value) {
        values[String(key)] = String(value);
      },
      removeItem: function (key) {
        delete values[String(key)];
      },
      clear: function () {
        values = Object.create(null);
      }
    };
  }

  function ensureStorage(name) {
    try {
      var storage = window[name];
      storage.getItem("__agx_storage_probe__");
      return;
    } catch (_) {
      // Sandboxed srcDoc documents have an opaque origin and may reject storage access.
    }

    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        value: createMemoryStorage()
      });
    } catch (_) {
      // Leave the native property untouched if the host refuses to redefine it.
    }
  }

  ensureStorage("localStorage");
  ensureStorage("sessionStorage");
})();
`.trim();

/**
 * Make storage-dependent HTML render inside the isolated srcDoc iframe.
 *
 * The preview intentionally omits `allow-same-origin`. In that sandbox,
 * localStorage/sessionStorage can throw before the page's own initialization
 * code runs. The fallback is in-memory and scoped to this preview iframe.
 */
export function injectHtmlPreviewStorageBridge(html: string): string {
  let src = String(html ?? "");
  if (src.includes(HTML_PREVIEW_STORAGE_BRIDGE_MARK)) return src;

  const snippet = `<script>${HTML_PREVIEW_STORAGE_BRIDGE}</script>`;
  const headOpen = /<head\b[^>]*>/i;
  if (headOpen.test(src)) {
    return src.replace(headOpen, (match) => `${match}${snippet}`);
  }

  const bodyOpen = /<body\b[^>]*>/i;
  if (bodyOpen.test(src)) {
    return src.replace(bodyOpen, `${snippet}$&`);
  }

  const htmlOpen = /<html\b[^>]*>/i;
  if (htmlOpen.test(src)) {
    return src.replace(htmlOpen, (match) => `${match}${snippet}`);
  }

  return `${snippet}${src}`;
}
