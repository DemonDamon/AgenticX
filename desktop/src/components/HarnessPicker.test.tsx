// @vitest-environment jsdom
/**
 * PreferredHarnessPicker + preferred-harness util tests.
 *
 * Covers: catalog fetch, unavailable fail-closed (gray + disabled),
 * selection persists preferredHarnessId (Settings default for new sessions),
 * and does NOT call mid-session switchSessionHarness.
 *
 * Author: Damon Li
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("PreferredHarnessPicker", () => {
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

  it("lists catalog with builtin selected by default", async () => {
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
    expect(await screen.findByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("CodeBuddy")).toBeTruthy();
    const builtin = screen.getByRole("option", { name: /Built-in Runtime/i });
    expect(builtin.getAttribute("aria-selected")).toBe("true");
  });

  it("grays out unavailable harnesses and blocks selection", async () => {
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    const option = (await screen.findByRole("option", {
      name: /CodeBuddy/i,
    })) as HTMLButtonElement;
    expect(option.disabled).toBe(true);
    expect(option.className).toContain("opacity-45");
    expect(option.textContent || "").toMatch(/Local CLI not installed/i);

    fireEvent.click(option);
    expect(useAppStore.getState().preferredHarnessId ?? null).toBe(null);
    expect(
      (window as unknown as { agenticxDesktop: { switchSessionHarness: ReturnType<typeof vi.fn> } })
        .agenticxDesktop.switchSessionHarness,
    ).not.toHaveBeenCalled();
  });

  it("selecting an available harness persists preferredHarnessId only", async () => {
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    fireEvent.click(await screen.findByRole("option", { name: /Claude Code/i }));
    await waitFor(() => {
      expect(useAppStore.getState().preferredHarnessId).toBe("claude-code");
    });
    expect(
      (window as unknown as { agenticxDesktop: { switchSessionHarness: ReturnType<typeof vi.fn> } })
        .agenticxDesktop.switchSessionHarness,
    ).not.toHaveBeenCalled();
  });

  it("re-selecting builtin clears preferredHarnessId", async () => {
    useAppStore.setState({ preferredHarnessId: "claude-code" });
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    fireEvent.click(await screen.findByRole("option", { name: /Built-in Runtime/i }));
    await waitFor(() => {
      expect(useAppStore.getState().preferredHarnessId ?? null).toBe(null);
    });
  });

  it("renders load-failed copy when the catalog fetch rejects", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    render(
      <PreferredHarnessPicker
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    expect(await screen.findByText(/Failed to load engines/i)).toBeTruthy();
  });
});
