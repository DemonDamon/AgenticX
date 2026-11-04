// @vitest-environment jsdom
/**
 * PreferredHarnessPicker enum (SettingsDropdown) + preferred-harness util tests.
 *
 * Covers: catalog → dropdown options, unavailable options disabled in menu,
 * selection persists preferredHarnessId, no mid-session switchSessionHarness.
 *
 * Author: Damon Li
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferredHarnessPicker } from "./HarnessPicker";
import { useAppStore } from "../store";
import {
  BUILTIN_HARNESS_ID,
  bindPreferredHarnessToSession,
  normalizePreferredHarnessId,
  toStoredPreferredHarnessId,
} from "../utils/preferred-harness";

type HarnessCatalogEntry = {
  harness_id: string;
  display_name: string;
  description?: string;
  available: boolean;
  builtin?: boolean;
  capabilities?: Record<string, boolean>;
};

const CATALOG: HarnessCatalogEntry[] = [
  {
    harness_id: "python-agent",
    display_name: "AgenticX Built-in Runtime",
    available: true,
    builtin: true,
  },
  {
    harness_id: "claude-code",
    display_name: "Claude Code",
    available: true,
    capabilities: { permission: true, pty: true },
  },
  {
    harness_id: "codebuddy",
    display_name: "CodeBuddy",
    available: false,
    capabilities: { idempotency: true },
  },
];

const fetchMock = vi.fn();

describe("preferred-harness util", () => {
  it("normalizes empty and builtin to builtin id", () => {
    expect(normalizePreferredHarnessId(null)).toBe(BUILTIN_HARNESS_ID);
    expect(normalizePreferredHarnessId("")).toBe(BUILTIN_HARNESS_ID);
    expect(normalizePreferredHarnessId("python-agent")).toBe(BUILTIN_HARNESS_ID);
    expect(normalizePreferredHarnessId("claude-code")).toBe("claude-code");
  });

  it("stores null for builtin preference", () => {
    expect(toStoredPreferredHarnessId("python-agent")).toBe(null);
    expect(toStoredPreferredHarnessId("claude-code")).toBe("claude-code");
  });

  it("bindPreferredHarnessToSession sets pane + calls setSessionHarness for non-builtin", async () => {
    const setPaneHarness = vi.fn();
    const setSessionHarness = vi.fn().mockResolvedValue({ ok: true });
    await bindPreferredHarnessToSession("pane-1", "sess-1", {
      getPreferredHarnessId: () => "claude-code",
      setPaneHarness,
      setSessionHarness,
    });
    expect(setPaneHarness).toHaveBeenCalledWith("pane-1", "claude-code");
    expect(setSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-1",
      harnessId: "claude-code",
    });
  });

  it("bindPreferredHarnessToSession skips server bind for builtin preference", async () => {
    const setPaneHarness = vi.fn();
    const setSessionHarness = vi.fn();
    await bindPreferredHarnessToSession("pane-1", "sess-1", {
      getPreferredHarnessId: () => null,
      setPaneHarness,
      setSessionHarness,
    });
    expect(setPaneHarness).toHaveBeenCalledWith("pane-1", null);
    expect(setSessionHarness).not.toHaveBeenCalled();
  });

  it("fail closed: reverts pane harness when setSessionHarness fails", async () => {
    const setPaneHarness = vi.fn();
    const setSessionHarness = vi.fn().mockResolvedValue({ ok: false, error: "boom" });
    await bindPreferredHarnessToSession("pane-1", "sess-1", {
      getPreferredHarnessId: () => "claude-code",
      setPaneHarness,
      setSessionHarness,
    });
    expect(setPaneHarness).toHaveBeenLastCalledWith("pane-1", null);
  });
});

describe("PreferredHarnessPicker (enum)", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "fetch",
      (...args: Parameters<typeof fetch>) => fetchMock(...args),
    );
  });

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ harnesses: CATALOG }),
    });
    vi.stubGlobal("agenticxDesktop", {
      setSessionHarness: vi.fn().mockResolvedValue({ ok: true }),
      switchSessionHarness: vi.fn().mockResolvedValue({ ok: true }),
    });
    useAppStore.setState({
      preferredHarnessId: null,
      setPreferredHarnessId: (harnessId: string | null) => {
        useAppStore.setState({ preferredHarnessId: harnessId });
      },
    } as Partial<typeof useAppStore.getState>);
  });

  async function openMenu() {
    // Wait for catalog load so trigger is enabled and shows builtin label
    const trigger = await screen.findByRole("button", { name: /Built-in Runtime/i });
    fireEvent.click(trigger);
    return screen.findByRole("listbox");
  }

  it("loads catalog into a SettingsDropdown enum with builtin selected", async () => {
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9740/api/harnesses",
        expect.objectContaining({
          headers: { "x-agx-desktop-token": "tok" },
        }),
      ),
    );
    expect(await screen.findByRole("button", { name: /Built-in Runtime/i })).toBeTruthy();
    expect(screen.getByText(/默认执行引擎|Default coding engine/i)).toBeTruthy();

    const listbox = await openMenu();
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBe(3);
    expect(within(listbox).getByRole("option", { name: /Claude Code/i })).toBeTruthy();
    const unavailable = within(listbox).getByRole("option", {
      name: /CodeBuddy.*local CLI not installed|CodeBuddy.*本机 CLI 未安装/i,
    }) as HTMLButtonElement;
    expect(unavailable.disabled).toBe(true);
  });

  it("unavailable option is disabled and does not change preference", async () => {
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    const listbox = await openMenu();
    const unavailable = within(listbox).getByRole("option", {
      name: /CodeBuddy/i,
    }) as HTMLButtonElement;
    expect(unavailable.disabled).toBe(true);
    fireEvent.click(unavailable);
    expect(useAppStore.getState().preferredHarnessId ?? null).toBe(null);
    expect(
      (window as unknown as { agenticxDesktop: { switchSessionHarness: ReturnType<typeof vi.fn> } })
        .agenticxDesktop.switchSessionHarness,
    ).not.toHaveBeenCalled();
  });

  it("selecting an available option persists preferredHarnessId only", async () => {
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    const listbox = await openMenu();
    fireEvent.click(within(listbox).getByRole("option", { name: /^Claude Code$/i }));
    await waitFor(() => {
      expect(useAppStore.getState().preferredHarnessId).toBe("claude-code");
    });
    expect(
      (window as unknown as { agenticxDesktop: { switchSessionHarness: ReturnType<typeof vi.fn> } })
        .agenticxDesktop.switchSessionHarness,
    ).not.toHaveBeenCalled();
    // menu closed; trigger shows selected label
    expect(await screen.findByRole("button", { name: /Claude Code/i })).toBeTruthy();
  });

  it("re-selecting builtin clears preferredHarnessId", async () => {
    useAppStore.setState({ preferredHarnessId: "claude-code" });
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    const trigger = await screen.findByRole("button", { name: /Claude Code/i });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByRole("option", { name: /Built-in Runtime/i }));
    await waitFor(() => {
      expect(useAppStore.getState().preferredHarnessId ?? null).toBe(null);
    });
  });

  it("disables the enum trigger when catalog fetch fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    const trigger = await screen.findByRole("button", {
      name: /Failed to load engines|执行引擎列表加载失败/i,
    });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});
