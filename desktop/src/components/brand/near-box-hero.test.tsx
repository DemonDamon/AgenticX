// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NearBoxHero } from "./NearBoxHero";
import { NEAR_BOX_MOOD_CYCLE, holdMs, hopMs, wanderMs } from "./near-box-moods";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NearBoxHero", () => {
  it("mounts the owned Near character from local SVG primitives", () => {
    const { getByTestId, queryByRole } = render(<NearBoxHero size={160} />);
    const root = getByTestId("near-box-hero");
    const svg = root.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("data-character")).toBe("near-box-original");
    expect(svg?.getAttribute("shape-rendering")).toBe("geometricPrecision");
    const outerShell = svg?.querySelector('[data-part="outer-shell"]');
    expect(outerShell).toBeTruthy();
    expect(outerShell?.getAttribute("stroke")).toBeNull();
    expect(svg?.querySelector('[data-part="shell-clip"]')).toBeTruthy();
    expect(svg?.querySelector('[data-part="top-face"]')).toBeTruthy();
    expect(svg?.querySelector('[data-part="left-face"]')).toBeTruthy();
    expect(svg?.querySelector('[data-part="right-face"]')).toBeTruthy();
    expect(svg?.querySelector('[data-part="top-wing"]')).toBeNull();
    expect(svg?.querySelectorAll('[data-part="sensor"]')).toHaveLength(2);
    expect(svg?.querySelector('[data-part="core"]')).toBeNull();
    expect(svg?.querySelector('[data-part="signal"]')).toBeNull();
    expect(svg?.querySelector('[data-part="pupil"]')).toBeNull();
    expect(svg?.querySelector('[data-part="mouth"]')).toBeNull();
    const sensors = svg?.querySelectorAll('[data-part="sensor"]');
    expect(sensors?.[0]?.getAttribute("cy")).toBe("108");
    expect(sensors?.[1]?.getAttribute("cy")).toBe("97");
    expect(root.getAttribute("data-gaze")).toBe("wander");
    expect(root.getAttribute("data-mood")).toBe("rest");
    expect(root.getAttribute("data-eye-shape")).toBe("restSoft");
    expect(root.getAttribute("data-lid")).toBe("1");
    expect(root.querySelector(".near-box-sensor-blink")).toBeNull();
    expect(sensors?.[0]?.getAttribute("data-kind")).toBe("oval");
    expect(root.querySelector('[data-part="sensor-clip"]')).toBeTruthy();
    expect(root.querySelector(".near-box-sensor-glint")).toBeNull();
    expect(root.querySelector('[data-part="sensor-glint"]')).toBeNull();
    expect(root.querySelector("img")).toBeNull();
    expect(queryByRole("img")?.tagName.toLowerCase()).toBe("svg");
    expect(root.querySelector('[data-part="box-flap"]')).toBeNull();
    expect(root.querySelector('[data-part="confetti"]')).toBeNull();
  });

  it("shows the orange brand tagline under the box", () => {
    const { getByTestId } = render(<NearBoxHero />);
    const tagline = getByTestId("near-box-tagline");
    expect(tagline.textContent).toBe("Near, Always Near.");
    expect(tagline.className).toContain("near-box-tagline");
  });

  it("becomes active when the pointer is on the box", () => {
    const { getByTestId } = render(<NearBoxHero />);
    const root = getByTestId("near-box-hero");
    fireEvent.pointerEnter(root);
    expect(root.getAttribute("data-state")).toBe("active");
    fireEvent.pointerLeave(root);
    expect(root.getAttribute("data-state")).toBe("idle");
  });

  it("moves the sensor windows toward the pointer", () => {
    const { getByTestId } = render(<NearBoxHero size={160} />);
    const root = getByTestId("near-box-hero");
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 160,
        height: 160,
        right: 160,
        bottom: 160,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerMove(root, { clientX: 160, clientY: 80 });

    const sensors = root.querySelector<SVGElement>('[data-part="sensor-group"]');
    expect(sensors?.style.transform).toContain("translate(3px, 0px)");
    expect(root.getAttribute("data-gaze")).toBe("track");
  });

  it("returns to an idle wander gaze after the pointer leaves", () => {
    const { getByTestId } = render(<NearBoxHero size={160} />);
    const root = getByTestId("near-box-hero");
    fireEvent.pointerEnter(root);
    fireEvent.pointerLeave(root);
    expect(root.getAttribute("data-gaze")).toBe("wander");
    expect(root.getAttribute("data-mood")).toBe("rest");
  });

  it("glances away from rest on an irregular hold, never using the old extra faces", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { getByTestId } = render(<NearBoxHero />);
    const root = getByTestId("near-box-hero");
    expect(root.getAttribute("data-mood")).toBe("rest");

    act(() => {
      vi.advanceTimersByTime(holdMs("rest", 0.9) - 1);
    });
    expect(root.getAttribute("data-mood")).toBe("rest");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const peeked = root.getAttribute("data-mood");
    expect(NEAR_BOX_MOOD_CYCLE).toContain(peeked);
    expect(peeked).not.toBe("rest");
    expect(peeked).not.toBe("angry");
    expect(peeked).not.toBe("scared");
  });

  it("hops the rest playlist on the same face without changing mood", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { getByTestId } = render(<NearBoxHero />);
    const root = getByTestId("near-box-hero");
    expect(root.getAttribute("data-mood")).toBe("rest");
    expect(root.getAttribute("data-eye-shape")).toBe("restSoft");

    act(() => {
      vi.advanceTimersByTime(hopMs("rest", 0.9) - 1);
    });
    expect(root.getAttribute("data-eye-shape")).toBe("restSoft");
    expect(root.getAttribute("data-mood")).toBe("rest");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(root.getAttribute("data-mood")).toBe("rest");
    expect(root.getAttribute("data-eye-shape")).toBe("restLean");
    const left = root.querySelector('[data-part="sensor"]');
    expect(Number(left?.getAttribute("cx"))).toBeGreaterThan(90);
    expect(Number(left?.getAttribute("cx"))).toBeLessThan(120);
  });

  it("looks around by itself while idle, without needing a hover", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { getByTestId } = render(<NearBoxHero />);
    const root = getByTestId("near-box-hero");
    const home = root.querySelector('[data-part="sensor"]')?.getAttribute("cx");
    expect(root.getAttribute("data-mood")).toBe("rest");
    expect(home).toBe("104");

    act(() => {
      vi.advanceTimersByTime(wanderMs("rest", 0.9));
    });
    expect(root.getAttribute("data-mood")).toBe("rest");
    expect(root.querySelector('[data-part="sensor"]')?.getAttribute("cx")).not.toBe(home);
    expect(root.getAttribute("data-gaze")).toBe("wander");
  });

  it("listens on hover, looks surprised when opened, and changes the sensor pair", () => {
    const { getByTestId } = render(<NearBoxHero />);
    const root = getByTestId("near-box-hero");
    expect(root.getAttribute("data-eye-shape")).toBe("restSoft");

    fireEvent.pointerEnter(root);
    expect(root.getAttribute("data-mood")).toBe("listening");
    expect(root.getAttribute("data-eye-shape")).toBe("listenTall");
    const listenLeft = root.querySelector('[data-part="sensor"]');
    expect(Number(listenLeft?.getAttribute("ry"))).toBeGreaterThan(
      Number(listenLeft?.getAttribute("rx")),
    );

    fireEvent.click(root);
    expect(root.getAttribute("data-mood")).toBe("surprised");
    expect(root.getAttribute("data-eye-shape")).toBe("roundOpen");
    expect(root.querySelector('[data-part="sensor"]')?.getAttribute("data-kind")).toBe("oval");
  });

  it("opens the lid and launches confetti when clicked", () => {
    const { getByTestId } = render(<NearBoxHero />);
    const root = getByTestId("near-box-hero");

    fireEvent.click(root);

    expect(root.getAttribute("data-bursting")).toBe("true");
    const confetti = root.querySelectorAll<HTMLElement>('[data-part="confetti"]');
    expect(confetti.length).toBeGreaterThan(44);
    expect(confetti[0]?.style.getPropertyValue("--confetti-fall")).toBe("");
    const spread = Array.from(confetti, (piece) =>
      Number.parseInt(piece.style.getPropertyValue("--confetti-x"), 10),
    );
    expect(Math.min(...spread)).toBeLessThan(-160);
    expect(Math.max(...spread)).toBeGreaterThan(160);
    expect(root.querySelector('[data-part="burst-ring"]')).toBeNull();
    expect(root.querySelectorAll('[data-part="box-flap"]')).toHaveLength(4);
    expect(root.querySelector('[data-part="box-cavity"]')).toBeTruthy();
    expect(root.querySelector('[data-part="box-inner-wall"]')).toBeNull();
    const flapPaths = Array.from(root.querySelectorAll('[data-part="box-flap"]')).map((node) =>
      node.getAttribute("d"),
    );
    expect(flapPaths).toEqual([
      expect.stringContaining("M80 18L16 58"),
      expect.stringContaining("M80 18L144 58"),
      expect.stringContaining("M16 58L80 96"),
      expect.stringContaining("M144 58L80 96"),
    ]);
    expect(root.querySelector('[data-part="firework"]')).toBeNull();
  });
});
