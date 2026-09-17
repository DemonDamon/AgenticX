// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NearBoxHero } from "./NearBoxHero";

afterEach(() => {
  cleanup();
});

describe("NearBoxHero", () => {
  it("mounts the spring character as vector paths", () => {
    const { getByTestId, queryByRole } = render(<NearBoxHero size={160} />);
    const root = getByTestId("near-box-hero");
    const svg = root.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(root.querySelector("img")).toBeNull();
    expect(queryByRole("img")?.tagName.toLowerCase()).toBe("svg");
  });

  it("shows the orange brand tagline under the box", () => {
    const { getByTestId } = render(<NearBoxHero />);
    const tagline = getByTestId("near-box-tagline");
    expect(tagline.textContent).toBe("Near, Always Near.");
    expect(tagline.className).toContain("near-box-tagline");
  });

  it("gets excited when the pointer is on the box", () => {
    const { getByTestId } = render(<NearBoxHero />);
    const root = getByTestId("near-box-hero");
    fireEvent.pointerEnter(root);
    expect(root.getAttribute("data-mood")).toBe("excited");
    fireEvent.pointerLeave(root);
    expect(root.getAttribute("data-mood")).not.toBe("excited");
  });
});
