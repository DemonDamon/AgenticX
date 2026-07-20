import { describe, expect, it } from "vitest";
import { injectHtmlPreviewStorageBridge } from "./html-preview-storage";

describe("injectHtmlPreviewStorageBridge", () => {
  it("injects before author scripts in the head", () => {
    const html = `<html><head><script>window.pageReady = true;</script></head><body></body></html>`;
    const out = injectHtmlPreviewStorageBridge(html);

    expect(out.indexOf("__agxHtmlPreviewStorageBridge")).toBeGreaterThan(out.indexOf("<head>"));
    expect(out.indexOf("__agxHtmlPreviewStorageBridge")).toBeLessThan(out.indexOf("window.pageReady"));
  });

  it("injects before body content when there is no head", () => {
    const html = `<body><script>window.pageReady = true;</script></body>`;
    const out = injectHtmlPreviewStorageBridge(html);

    expect(out.indexOf("__agxHtmlPreviewStorageBridge")).toBeLessThan(out.indexOf("window.pageReady"));
  });

  it("does not inject the bridge more than once", () => {
    const html = `<html><head></head><body></body></html>`;
    const once = injectHtmlPreviewStorageBridge(html);
    const twice = injectHtmlPreviewStorageBridge(once);

    expect(twice).toBe(once);
    expect((twice.match(/__agxHtmlPreviewStorageBridge/g) ?? []).length).toBe(2);
  });
});
