// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("EmptyStateCornerLotties", () => {
  it("pins looping figures to clipped floor slots", () => {
    const { getAllByTestId } = render(<EmptyStateCornerLotties />);
    const slots = getAllByTestId("empty-lottie-slot");
    expect(slots).toHaveLength(2);
    expect(slots[0]!.getAttribute("data-side")).toBe("left");
    expect(slots[0]!.className).toContain("bottom-2");
    expect(slots[0]!.className).toContain("left-6");
    expect(slots[1]!.getAttribute("data-side")).toBe("right");
    expect(slots[1]!.className).toContain("bottom-2");
    expect(slots[1]!.className).toContain("right-6");

    const nodes = getAllByTestId("empty-lottie");
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(node.dataset.loop).toBe("true");
    }
  });
});
