/**
 * Author: Damon Li
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupSenderRail } from "./GroupSenderRail";

describe("GroupSenderRail", () => {
  it("renders a compact avatar and gray name around children", () => {
    const html = renderToStaticMarkup(
      <GroupSenderRail
        name="架构师"
        avatarUrl="https://example.test/architect.png"
        avatarId="architect"
      >
        <div className="confirm-card">等待你的确认…</div>
      </GroupSenderRail>,
    );
    expect(html).toContain("agx-group-sender-rail");
    expect(html).toContain("agx-im-avatar");
    expect(html).toContain("h-7 w-7");
    expect(html).toContain("https://example.test/architect.png");
    expect(html).toContain("架构师");
    expect(html).toContain("等待你的确认…");
  });
});
