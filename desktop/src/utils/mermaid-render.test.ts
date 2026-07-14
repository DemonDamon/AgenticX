import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({
    svg: '<svg viewBox="0 0 10 10"><text>ok</text></svg>',
  })),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: mermaidMocks.initialize,
    render: mermaidMocks.render,
  },
}));

import { mermaidThemeFromApp, renderMermaidSvg } from "./mermaid-render";

describe("mermaid-render", () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockClear();
    mermaidMocks.render.mockClear();
  });

  it("initializes with strict security and requested theme", async () => {
    const svg = await renderMermaidSvg({
      code: "flowchart LR\n  A --> B",
      id: "mmd-test-1",
      theme: "dark",
    });
    expect(mermaidMocks.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
    });
    expect(mermaidMocks.render).toHaveBeenCalledWith(
      "mmd-test-1",
      "flowchart LR\n  A --> B",
    );
    expect(svg).toContain("<svg");
  });

  it("rejects empty source", async () => {
    await expect(
      renderMermaidSvg({ code: "   ", id: "mmd-empty", theme: "default" }),
    ).rejects.toThrow("Mermaid source is empty.");
  });

  it("maps app themes to mermaid themes", () => {
    expect(mermaidThemeFromApp("light")).toBe("default");
    expect(mermaidThemeFromApp("dark")).toBe("dark");
    expect(mermaidThemeFromApp("dim")).toBe("dark");
  });
});
