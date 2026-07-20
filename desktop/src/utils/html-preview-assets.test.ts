import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareLocalHtmlSrcDoc } from "./html-preview-assets";

describe("prepareLocalHtmlSrcDoc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rewrites relative img src to data URLs via loadLocalImageDataUrl", async () => {
    const loadLocalImageDataUrl = vi.fn(async (path: string) => {
      if (path.endsWith("chart.svg")) {
        return { ok: true, dataUrl: "data:image/svg+xml;charset=utf-8,svg1" };
      }
      return { ok: false, error: "missing" };
    });
    vi.stubGlobal("window", {
      agenticxDesktop: { loadLocalImageDataUrl },
    });

    const html = `<img src="chart.svg" alt="c" /><img src="https://cdn.example/a.png" />`;
    const out = await prepareLocalHtmlSrcDoc("/Users/damon/charts/index.html", html);
    expect(out).toContain('src="data:image/svg+xml;charset=utf-8,svg1"');
    expect(out).toContain('src="https://cdn.example/a.png"');
    expect(loadLocalImageDataUrl).toHaveBeenCalledWith("/Users/damon/charts/chart.svg");
  });

  it("resolves Chinese filenames next to the HTML file", async () => {
    const loadLocalImageDataUrl = vi.fn(async () => ({
      ok: true,
      dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg/%3E",
    }));
    vi.stubGlobal("window", {
      agenticxDesktop: { loadLocalImageDataUrl },
    });

    const html = `<img src="A股科技股三种情景对比.svg" alt="x" />`;
    const out = await prepareLocalHtmlSrcDoc(
      "/Users/damon/.agenticx/avatars/x/workspace/charts/index.html",
      html,
    );
    expect(out).toContain("data:image/svg+xml");
    expect(loadLocalImageDataUrl).toHaveBeenCalledWith(
      "/Users/damon/.agenticx/avatars/x/workspace/charts/A股科技股三种情景对比.svg",
    );
  });

  it("leaves HTML unchanged when desktop APIs are unavailable", async () => {
    vi.stubGlobal("window", {});
    const html = `<img src="chart.svg" />`;
    const out = await prepareLocalHtmlSrcDoc("/tmp/index.html", html);
    expect(out).toBe(html);
  });
});
