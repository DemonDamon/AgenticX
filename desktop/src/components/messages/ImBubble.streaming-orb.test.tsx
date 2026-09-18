// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store";
import { ImBubble } from "./ImBubble";

afterEach(() => {
  cleanup();
});

describe("ImBubble streaming wait mark", () => {
  it("uses a themed particle orb instead of the square face", () => {
    const previous = useAppStore.getState().themeColor;
    useAppStore.setState({ themeColor: "blue" });
    const { container } = render(
      <ImBubble message={{ id: "__stream__", role: "assistant", content: "" }} />,
    );
    const orb = container.querySelector('[data-part="orb-burst"]');
    expect(orb).toBeTruthy();
    expect(orb?.getAttribute("data-orb")).toBe("winding");
    expect(orb?.getAttribute("data-optical-x")).toBe("-3");
    expect((orb as HTMLElement | null)?.style.transform).toContain("translateX(-3px)");
    expect(orb?.getAttribute("data-dot-color")).toBe("#3b82f6");
    expect(container.querySelector(".agx-near-buddy")).toBeNull();
    useAppStore.setState({ themeColor: previous });
  });
});
