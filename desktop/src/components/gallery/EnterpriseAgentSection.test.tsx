// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import type { EnterpriseAgentCard } from "../../utils/ma-pane";

const openManagedAgentPane = vi.fn();

vi.mock("../../hooks/usePaneNavigation", () => ({
  usePaneNavigation: () => ({ openManagedAgentPane }),
}));

vi.mock("../../utils/studio-fetch", () => ({
  studioFetch: vi.fn(() => new Promise(() => undefined)),
}));

import { EnterpriseAgentSection } from "./EnterpriseAgentSection";

const AGENT = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";

function card(patch: Partial<EnterpriseAgentCard> = {}): EnterpriseAgentCard {
  return {
    id: AGENT,
    displayName: "报告助手",
    description: null,
    runtime: "cloud",
    model: "openai/gpt-4o",
    origin: "enterprise",
    latestVersion: 3,
    effectiveVersion: 2,
    routingMode: "follow_latest",
    defaultEnvironment: null,
    executionTarget: "cloud",
    ownedByMe: false,
    ...patch,
  };
}

beforeEach(async () => {
  openManagedAgentPane.mockReset();
  await i18n.changeLanguage("zh");
});

afterEach(() => {
  cleanup();
});

describe("EnterpriseAgentSection", () => {
  it("returns null for empty list", () => {
    const { container } = render(<EnterpriseAgentSection agents={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders badge, version and execution label", () => {
    render(<EnterpriseAgentSection agents={[card()]} />);
    expect(screen.getByText("企业")).toBeTruthy();
    expect(screen.getByText("v2")).toBeTruthy();
    expect(screen.getByText("云端执行")).toBeTruthy();
    expect(screen.getByText("报告助手")).toBeTruthy();
  });

  it("clicking a card opens the managed pane", () => {
    const agent = card();
    render(<EnterpriseAgentSection agents={[agent]} />);
    fireEvent.click(screen.getByTestId("enterprise-agent-card"));
    expect(openManagedAgentPane).toHaveBeenCalledWith(agent);
  });

  it("definition button opens drawer without opening pane", () => {
    render(<EnterpriseAgentSection agents={[card()]} />);
    fireEvent.click(screen.getByRole("button", { name: "查看定义" }));
    expect(openManagedAgentPane).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("desktop agent without environment is disabled", () => {
    render(<EnterpriseAgentSection agents={[card({
      runtime: "desktop_worker",
      executionTarget: "desktop_worker",
      defaultEnvironment: null,
    })]} />);
    fireEvent.click(screen.getByTestId("enterprise-agent-card"));
    expect(openManagedAgentPane).not.toHaveBeenCalled();
    expect(screen.getByText("管理员尚未为该智能体指定执行环境")).toBeTruthy();
    expect(screen.getByTestId("enterprise-agent-card").getAttribute("data-disabled")).toBe("true");
  });
});
