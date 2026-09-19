import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GroupTalkReportCard } from "./GroupTalkReportCard";

describe("GroupTalkReportCard", () => {
  it("renders a collapsed write-up chip without the report body", () => {
    const html = renderToStaticMarkup(
      <GroupTalkReportCard content={"## 背景\n本轮核对了差旅和外包。"} />,
    );
    expect(html).toContain('data-slot="group-talk-report"');
    expect(html).not.toContain("本轮核对了差旅和外包");
  });

  it("renders nothing for empty remainder", () => {
    const html = renderToStaticMarkup(<GroupTalkReportCard content="   " />);
    expect(html).toBe("");
  });
});
