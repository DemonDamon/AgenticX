import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CrewSlot } from "../../utils/group-member-activity";
import { CrewWorkstationWall } from "./CrewWorkstationWall";

function slot(partial: Partial<CrewSlot> & Pick<CrewSlot, "agentId" | "phase">): CrewSlot {
  return {
    actionText: "",
    elapsedMs: 0,
    replies: 0,
    toolCalls: 0,
    lastTs: 0,
    ...partial,
  };
}

describe("CrewWorkstationWall", () => {
  it("renders running action text with shimmer", () => {
    const html = renderToStaticMarkup(
      <CrewWorkstationWall
        slots={[
          slot({
            agentId: "a1",
            phase: "running",
            actionText: "正在调用 file_read",
            elapsedMs: 12_000,
          }),
        ]}
        avatarById={new Map()}
        metaLeaderLabel="Machi"
      />,
    );
    expect(html).toContain("正在调用 file_read");
    expect(html).toContain("agx-working-shimmer");
    expect(html).toContain("12s");
  });

  it("keeps idle slots static without shimmer or duration", () => {
    const html = renderToStaticMarkup(
      <CrewWorkstationWall
        slots={[slot({ agentId: "a1", phase: "idle" })]}
        avatarById={new Map()}
        metaLeaderLabel="Machi"
      />,
    );
    expect(html).not.toContain("agx-working-shimmer");
    expect(html).not.toContain("12s");
    expect(html).toContain("未执行");
  });

  it("renders nearby actions only when callbacks are provided", () => {
    const withCbs = renderToStaticMarkup(
      <CrewWorkstationWall
        slots={[slot({ agentId: "a1", phase: "waiting", actionText: "等待确认后继续" })]}
        avatarById={new Map()}
        metaLeaderLabel="Machi"
        onAppendDirective={vi.fn()}
        onSwitchModel={vi.fn()}
        onInterrupt={vi.fn()}
      />,
    );
    expect(withCbs).toContain("追加指令");
    expect(withCbs).toContain("换模型");
    expect(withCbs).toContain("打断");

    const withoutCbs = renderToStaticMarkup(
      <CrewWorkstationWall
        slots={[slot({ agentId: "a1", phase: "waiting", actionText: "等待确认后继续" })]}
        avatarById={new Map()}
        metaLeaderLabel="Machi"
      />,
    );
    expect(withoutCbs).not.toContain("追加指令");
    expect(withoutCbs).not.toContain("换模型");
    expect(withoutCbs).not.toContain("打断");
  });
});
