// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { EmptyStateCornerLotties } from "./EmptyStateCornerLotties";

vi.mock("lottie-react", () => ({
  LottieSvg: ({
    className,
    loop,
  }: {
    className?: string;
    loop?: boolean;
  }) => (
    <div
      data-testid="empty-lottie"
      data-loop={String(loop)}
      className={className}
    />
  ),
}));

afterEach(() => {
  cleanup();
});

describe("EmptyStateCornerLotties", () => {
  it("moves the woman further left and the man a little left without crowding", () => {
    const { getByTestId, getAllByTestId } = render(
      <EmptyStateCornerLotties stageSize={200}>
        <div data-testid="empty-hero-slot" />
      </EmptyStateCornerLotties>,
    );
    const row = getByTestId("empty-lottie-row");
    expect(row.className).toContain("relative");
    expect(row.style.width).toBe("200px");
    expect(getByTestId("empty-hero-slot")).toBeTruthy();

    const slots = getAllByTestId("empty-lottie-slot");
    expect(slots).toHaveLength(2);
    const left = slots[0]!;
    const right = slots[1]!;
    expect(left.getAttribute("data-side")).toBe("left");
    expect(right.getAttribute("data-side")).toBe("right");

    expect(left.className).toContain("w-[96px]");
    expect(left.className).toContain("left-[-84px]");
    expect(left.className).not.toContain("left-[-68px]");
    expect(left.className).toContain("bottom-0");
    expect(left.className).not.toContain("bottom-[-20px]");
    expect(left.className).not.toContain("overflow-hidden");

    expect(right.className).toContain("w-[64px]");
    expect(right.className).toContain("left-[96%]");
    expect(right.className).not.toContain("left-[92%]");
    expect(right.className).toContain("bottom-0");
    expect(right.className).not.toContain("bottom-[-28px]");
    expect(right.className).not.toContain("overflow-hidden");

    const stage = getByTestId("empty-lottie-horizon");
    expect(stage.className).toContain("inset-0");

    const nodes = getAllByTestId("empty-lottie");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.className).toContain("w-[96px]");
    expect(nodes[1]!.className).toContain("w-[64px]");
    for (const node of nodes) {
      expect(node.dataset.loop).toBe("true");
    }
  });

  it("follows the display accent so shirts rematch the cube", () => {
    const previous = useAppStore.getState().themeColor;
    useAppStore.setState({ themeColor: "blue" });
    const { getByTestId } = render(
      <EmptyStateCornerLotties>
        <div />
      </EmptyStateCornerLotties>,
    );
    expect(getByTestId("empty-lottie-row").getAttribute("data-accent")).toBe("blue");
    useAppStore.setState({ themeColor: previous });
  });
});
