import { describe, expect, it } from "vitest";
import { shouldAutoRunDeepResearch } from "./auto-need";

describe("shouldAutoRunDeepResearch", () => {
  it("does not turn ordinary follow-ups into deep research", () => {
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "把这段话改得更简洁" }])).toBe(false);
  });

  it("runs for an explicit research request", () => {
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "请做一份深度研究报告，比较三个方案" }])).toBe(true);
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "什么是深度研究？" }])).toBe(false);
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "请总结这份深度研究报告" }])).toBe(false);
  });

  it("requires scope for generic analysis wording", () => {
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "分析一下这个句子" }])).toBe(false);
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "系统分析近年市场趋势并给出来源、优缺点和决策建议" }])).toBe(true);
  });

  it("uses multiple deterministic signals for research-shaped tasks", () => {
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "帮我做竞品分析" }])).toBe(true);
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "比较 A 和 B" }])).toBe(false);
    expect(
      shouldAutoRunDeepResearch([
        { role: "user", content: "比较 A 和 B 的成本、风险和适用场景" },
      ]),
    ).toBe(true);
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "研究并总结市场趋势" }])).toBe(true);
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "研究一下最新的 API" }])).toBe(false);
  });

  it("inherits a strong research context for short referential follow-ups", () => {
    expect(
      shouldAutoRunDeepResearch([
        { role: "user", content: "请系统分析近年市场趋势并给出来源" },
        { role: "assistant", content: "上一轮结果" },
        { role: "user", content: "那成本和风险呢" },
      ]),
    ).toBe(true);
    expect(
      shouldAutoRunDeepResearch([
        { role: "user", content: "请系统分析近年市场趋势并给出来源" },
        { role: "user", content: "然后帮我把它改写得更简洁" },
      ]),
    ).toBe(false);
  });

  it("ignores appended attachment text when classifying the user instruction", () => {
    expect(
      shouldAutoRunDeepResearch([
        {
          role: "user",
          content: "请总结一下附件内容\n\n--- 附件: market-report.md ---\n系统分析近年市场趋势并给出来源",
        },
      ]),
    ).toBe(false);
  });

  it("supports multimodal text parts without scoring image URLs", () => {
    expect(
      shouldAutoRunDeepResearch([
        {
          role: "user",
          content: [
            { type: "text", text: "请比较两个方案的安全性、成本，并附官方来源" },
            { type: "image_url", image_url: { url: "https://example.test/image.png" } },
          ],
        },
      ]),
    ).toBe(true);
  });

  it("handles English research requests with the same conservative gate", () => {
    expect(
      shouldAutoRunDeepResearch([
        {
          role: "user",
          content: "Compare A and B across pricing, safety, ecosystem, and official sources.",
        },
      ]),
    ).toBe(true);
    expect(shouldAutoRunDeepResearch([{ role: "user", content: "What is the latest API version?" }])).toBe(false);
  });
});
