import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessageDeepResearch } from "@agenticx/core-api";
import { DeepResearchContinueCard } from "./DeepResearchContinueCard";

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return textOf(props.children);
  }
  return "";
}

function research(
  status: ChatMessageDeepResearch["status"],
  withResume: boolean,
): ChatMessageDeepResearch {
  return {
    runId: "old",
    status,
    events: withResume
      ? [{
          type: "report_resume_available",
          runId: "old",
          nextRunId: "new",
          completedSections: 4,
          totalSections: 6,
        }]
      : [],
  };
}

describe("DeepResearchContinueCard", () => {
  it("shows completed chapters and the continue action", () => {
    const onContinue = vi.fn();
    const element = DeepResearchContinueCard({ research: research("failed", true), onContinue });
    expect(textOf(element)).toContain("已完成 4 / 6 章");
    expect(textOf(element)).toContain("继续完成报告");
    expect(textOf(element)).toContain("继续写作仍受使用上限与内容策略限制");
    const button = findButton(element);
    button?.props.onClick();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("stays hidden without a checkpoint event or after a finished run", () => {
    expect(DeepResearchContinueCard({ research: research("failed", false), onContinue: vi.fn() })).toBeNull();
    expect(DeepResearchContinueCard({ research: research("completed", true), onContinue: vi.fn() })).toBeNull();
    expect(DeepResearchContinueCard({ research: research("cancelled", true) })).toMatchObject({
      props: expect.objectContaining({ children: expect.anything() }),
    });
  });
});

function findButton(node: ReactNode): { props: { onClick?: () => void; children?: ReactNode } } | null {
  if (!isValidElement(node)) return null;
  const props = node.props as { onClick?: () => void; children?: ReactNode; type?: string };
  if (props.type === "button" || props.onClick) {
    if (textOf(props.children).includes("继续完成报告")) return { props };
  }
  const children = Array.isArray(props.children) ? props.children : [props.children];
  for (const child of children) {
    const found = findButton(child);
    if (found) return found;
  }
  return null;
}
