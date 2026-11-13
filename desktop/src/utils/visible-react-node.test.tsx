import { describe, expect, it } from "vitest";
import { hasVisibleReactNode } from "./visible-react-node";

describe("hasVisibleReactNode", () => {
  it("treats nullish and empty fragments as invisible", () => {
    expect(hasVisibleReactNode(null)).toBe(false);
    expect(hasVisibleReactNode(undefined)).toBe(false);
    expect(hasVisibleReactNode(false)).toBe(false);
    expect(hasVisibleReactNode(<></>)).toBe(false);
    expect(hasVisibleReactNode(<>{null}{undefined}</>)).toBe(false);
    expect(hasVisibleReactNode("")).toBe(false);
    expect(hasVisibleReactNode("   ")).toBe(false);
  });

  it("treats real text and elements as visible", () => {
    expect(hasVisibleReactNode("card")).toBe(true);
    expect(hasVisibleReactNode(0)).toBe(true);
    expect(hasVisibleReactNode(<span>hello.txt-card</span>)).toBe(true);
    expect(hasVisibleReactNode(<><span>x</span></>)).toBe(true);
    expect(hasVisibleReactNode(<>{null}<span>y</span></>)).toBe(true);
  });
});
