import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "../..");

function readCss(rel: string): string {
  return readFileSync(resolve(srcRoot, rel), "utf8");
}

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `missing selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(start, close + 1);
}

describe("IM bubble tokens", () => {
  const indexCss = readCss("index.css");

  it("uses solid theme-color fill and on-color text for user bubbles", () => {
    const block = ruleBlock(indexCss, ":root[data-theme-color] {");
    expect(block).toContain("--chat-im-user-bg: rgb(var(--theme-color-rgb))");
    expect(block).toContain("--chat-im-user-text: var(--theme-color-text)");
    expect(indexCss).not.toContain("--chat-im-user-bg: rgba(var(--theme-color-rgb), 0.15)");
    expect(indexCss).not.toContain("--chat-im-user-bg: rgba(var(--theme-color-rgb), 0.22)");
    expect(indexCss).not.toContain("--chat-im-user-bg: rgba(var(--theme-color-rgb), 0.4)");
  });

  it("clusters group bubbles by sender continue, not left-side adjacency", () => {
    expect(indexCss).not.toContain(
      "[data-im-align=\"start\"] + [data-im-align=\"start\"] .agx-im-group-bubble",
    );
    expect(indexCss).toContain('.agx-group-thread [data-im-cluster="continue"] .agx-im-group-bubble');
    expect(indexCss).toContain(".agx-group-thread [data-im-cluster=\"continue\"] .agx-im-user-bubble");
  });

  it("keeps received assistant capsules on a neutral solid gray", () => {
    expect(readCss("styles/themes/dark.css")).toContain("--chat-im-assistant-bg: #3b3b3d");
    expect(readCss("styles/themes/dim.css")).toContain("--chat-im-assistant-bg: #3b3b3d");
    expect(readCss("styles/themes/light.css")).toContain("--chat-im-assistant-bg: #e9e9eb");
  });

  it("mixes in-bubble chips against user-text only", () => {
    const start = indexCss.indexOf(".agx-im-user-bubble .agx-composer-inline-chip");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = indexCss.indexOf(".agx-im-user-stack", start);
    const chipBlock = indexCss.slice(start, end);
    expect(chipBlock).not.toContain("var(--text-faint)");
    expect(chipBlock).not.toContain("var(--text-muted)");
  });

  it("paints user-bubble links with on-color text, not the fill color", () => {
    const start = indexCss.indexOf(".agx-im-user-bubble .msg-content a");
    expect(start).toBeGreaterThanOrEqual(0);
    const close = indexCss.indexOf("}", start);
    const block = indexCss.slice(start, close + 1);
    expect(block).toContain("color: var(--chat-im-user-text)");
    expect(block).not.toContain("theme-color-rgb");
  });
});
