// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShowWidgetDrawingPlaceholder } from "./ShowWidgetDrawingPlaceholder";

describe("ShowWidgetDrawingPlaceholder", () => {
  it("keeps the title as a caption instead of concatenating it into the status row", () => {
    render(
      <ShowWidgetDrawingPlaceholder
        title="Claude Code 兼容 AGENTS.md：实现控制与真实边界"
        statusLabel="正在绘制…"
      />,
    );
    expect(screen.getByText("正在绘制…")).toBeTruthy();
    expect(screen.getByText("Claude Code 兼容 AGENTS.md：实现控制与真实边界")).toBeTruthy();
    expect(screen.queryByText(/兼容 AGENTS.md.*正在绘制/)).toBeNull();
  });
});
