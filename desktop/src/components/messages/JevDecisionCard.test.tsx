import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Message } from "../../store";
import { JevDecisionCard } from "./JevDecisionCard";

function msg(partial: Partial<Message>): Message {
  return {
    id: "m1",
    role: "tool",
    content: "Jev",
    toolName: "jev",
    ...partial,
  };
}

describe("JevDecisionCard", () => {
  it("renders pending state with literal Jev", () => {
    const html = renderToStaticMarkup(
      <JevDecisionCard
        message={msg({
          toolStatus: "running",
          metadata: { kind: "jev_decision", phase: "pending", purpose: "group_routing" },
        })}
      />,
    );
    expect(html).toContain("Jev");
    expect(html).toContain("正在判断谁来回复");
  });

  it("renders adopted Jev decision with model and action", () => {
    const html = renderToStaticMarkup(
      <JevDecisionCard
        message={msg({
          toolStatus: "done",
          metadata: {
            kind: "jev_decision",
            phase: "done",
            source: "jev",
            model: "jev-1.13.0",
            action: "route_to",
            target_labels: ["财务"],
            confidence: 0.72,
            gate: "auto",
            probabilities: { route_to: 0.81, meta_direct: 0.12 },
          },
        })}
      />,
    );
    expect(html).toContain("Jev");
    expect(html).toContain("jev-1.13.0");
    expect(html).toContain("派给成员");
    expect(html).toContain("财务");
    expect(html).toContain("72%");
  });

  it("renders fallback unused state with literal Jev", () => {
    const html = renderToStaticMarkup(
      <JevDecisionCard
        message={msg({
          metadata: {
            kind: "jev_decision",
            phase: "done",
            source: "fallback",
            fallback_reason: "jev_no_key",
          },
        })}
      />,
    );
    expect(html).toContain("Jev");
    expect(html).toContain("未采用");
    expect(html).toContain("未配置密钥");
    expect(html).toContain("text-red-400");
  });

  it("renders low-confidence fallback in amber, not red", () => {
    const html = renderToStaticMarkup(
      <JevDecisionCard
        message={msg({
          metadata: {
            kind: "jev_decision",
            phase: "done",
            source: "fallback",
            fallback_reason: "jev_fallback_llm",
          },
        })}
      />,
    );
    expect(html).toContain("改走主模型");
    expect(html).toContain("置信不足");
    expect(html).toContain("text-amber-500");
    expect(html).not.toContain("text-red-400");
  });

  it("renders kb_auto gate with literal Jev", () => {
    const html = renderToStaticMarkup(
      <JevDecisionCard
        message={msg({
          metadata: {
            kind: "jev_kb_gate",
            phase: "done",
            purpose: "kb_auto",
            source: "jev",
            model: "jev-1.13.0",
            action: "skip",
            noul_execution: 0.1,
          },
        })}
      />,
    );
    expect(html).toContain("Jev");
    expect(html).toContain("跳过检索");
  });
});
