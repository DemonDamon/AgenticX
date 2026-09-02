import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageTurnMeta } from "./MessageTurnMeta";

describe("MessageTurnMeta", () => {
  it("renders input and output separately plus the bare model", () => {
    const html = renderToStaticMarkup(
      <MessageTurnMeta
        usage={{
          inputTokens: 28294,
          outputTokens: 369,
          cachedTokens: 0,
          reasoningTokens: 0,
          totalTokens: 28663,
        }}
        model="openai/kimi-k2.6"
        modelSelection="manual"
      />,
    );
    expect(html).toContain("本轮消耗");
    expect(html).toContain("28.3K");
    expect(html).toContain("369");
    expect(html).toContain("kimi-k2.6");
    expect(html).toContain('data-turn-usage-arrow="in"');
    expect(html).toContain('data-turn-usage-arrow="out"');
    expect(html).toContain("status-success");
    expect(html).not.toContain("theme-color-rgb");
    expect(html).toContain('data-turn-meta-sep="actions"');
    expect(html).toContain('data-turn-meta-sep="model"');
    expect(html).toContain("data-turn-meta-gutter");
    expect(html).toContain('data-turn-meta=""');
    expect(html).toContain("data-turn-model-chip");
    expect(html).toContain("bg-surface-card-strong");
    expect(html).not.toContain("rounded-full");
    expect(html).not.toContain("border-border");
    expect(html).not.toContain("font-mono");
    expect(html).not.toContain("arrow-up-from-line");
    expect(html).not.toContain("arrow-down-to-line");
    // The summed number would read as if one turn outgrew the whole session.
    expect(html).not.toContain("28,663");
    expect(html).not.toContain("auto");
  });

  it("renders auto prefix and bare model when selection is auto", () => {
    const html = renderToStaticMarkup(
      <MessageTurnMeta model="kimi-k2.6" modelSelection="auto" />,
    );
    expect(html).toContain("auto");
    expect(html).toContain("kimi-k2.6");
    expect(html).toContain("auto(kimi-k2.6)");
    // No usage on this row, so no up/down token counters.
    expect(html).not.toContain("↑");
    expect(html).not.toContain("↓");
  });

  it("flags a finished turn whose provider never returned usage", () => {
    const html = renderToStaticMarkup(
      <MessageTurnMeta model="glm-5.3-flash" modelSelection="manual" />,
    );
    expect(html).toContain("用量未返回");
    expect(html).toContain("glm-5.3-flash");
  });

  it("renders nothing for legacy rows without usage or model", () => {
    const html = renderToStaticMarkup(<MessageTurnMeta />);
    expect(html).toBe("");
  });
});
