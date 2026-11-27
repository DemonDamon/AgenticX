/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SubAgentCard } from "./SubAgentCard";
import type { SubAgent } from "../store";

afterEach(() => {
  cleanup();
});

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

function makeSubAgent(overrides: Partial<SubAgent> = {}): SubAgent {
  return {
    id: "sa-test-1",
    name: "Expert A",
    role: "analyst",
    task: "Analyze data",
    status: "running",
    events: [
      { id: "e1", type: "progress", content: "step 1", ts: 1 },
      { id: "e2", type: "progress", content: "step 2", ts: 2 },
    ],
    liveOutput: "chunk 1",
    ...overrides,
  };
}

function mockScrollMetrics(el: HTMLElement, scrollHeight: number, clientHeight = 100) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
}

describe("SubAgentCard ActivityTimeline scroll anchoring (#335)", () => {
  it("keeps live stream box mounted across placeholder transitions and respects upward scroll", () => {
    const noop = () => {};
    const { getByText, getByTestId, rerender } = render(
      <SubAgentCard
        subAgent={makeSubAgent({ liveOutput: "line 1" })}
        onCancel={noop}
        onRetry={noop}
        onChat={noop}
      />,
    );

    // Expand details to mount ActivityTimeline.
    fireEvent.click(getByText("subagent.details"));
    const liveBox = getByTestId("subagent-live-stream-scroll");
    mockScrollMetrics(liveBox, 400, 100);

    // Streaming token keeps box pinned to bottom.
    rerender(
      <SubAgentCard
        subAgent={makeSubAgent({ liveOutput: "line 1\nline 2" })}
        onCancel={noop}
        onRetry={noop}
        onChat={noop}
      />,
    );
    expect(liveBox.scrollTop).toBe(400);

    // Transient thinking placeholder must NOT unmount/remount the scroll container.
    rerender(
      <SubAgentCard
        subAgent={makeSubAgent({ liveOutput: "..." })}
        onCancel={noop}
        onRetry={noop}
        onChat={noop}
      />,
    );
    expect(getByTestId("subagent-live-stream-scroll")).toBe(liveBox);

    // User scrolls up to inspect earlier output: subsequent tokens must not jump back down.
    liveBox.scrollTop = 50;
    fireEvent.wheel(liveBox, { deltaY: -60 });
    fireEvent.scroll(liveBox);

    mockScrollMetrics(liveBox, 600, 100);
    rerender(
      <SubAgentCard
        subAgent={makeSubAgent({ liveOutput: "line 1\nline 2\nline 3" })}
        onCancel={noop}
        onRetry={noop}
        onChat={noop}
      />,
    );
    expect(liveBox.scrollTop).toBe(50);

    // User scrolls back near bottom: auto-scroll resumes.
    liveBox.scrollTop = 500;
    fireEvent.scroll(liveBox);
    mockScrollMetrics(liveBox, 720, 100);
    rerender(
      <SubAgentCard
        subAgent={makeSubAgent({ liveOutput: "line 1\nline 2\nline 3\nline 4" })}
        onCancel={noop}
        onRetry={noop}
        onChat={noop}
      />,
    );
    expect(liveBox.scrollTop).toBe(720);
  });

  it("does not force timeline to bottom after the user scrolls up", () => {
    const noop = () => {};
    const { getByText, getByTestId, rerender } = render(
      <SubAgentCard
        subAgent={makeSubAgent()}
        onCancel={noop}
        onRetry={noop}
        onChat={noop}
      />,
    );

    fireEvent.click(getByText("subagent.details"));
    const timeline = getByTestId("subagent-timeline-scroll");
    mockScrollMetrics(timeline, 300, 120);

    timeline.scrollTop = 20;
    fireEvent.wheel(timeline, { deltaY: -40 });
    fireEvent.scroll(timeline);

    mockScrollMetrics(timeline, 450, 120);
    rerender(
      <SubAgentCard
        subAgent={makeSubAgent({
          events: [
            { id: "e1", type: "progress", content: "step 1", ts: 1 },
            { id: "e2", type: "progress", content: "step 2", ts: 2 },
            { id: "e3", type: "progress", content: "step 3", ts: 3 },
          ],
        })}
        onCancel={noop}
        onRetry={noop}
        onChat={noop}
      />,
    );
    expect(timeline.scrollTop).toBe(20);
  });
});
