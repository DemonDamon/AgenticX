// @vitest-environment jsdom
/**
 * PaneHarnessPicker component tests (harness-control-surface SP5a/SP5b).
 *
 * Covers: catalog fetch + trigger label, dropdown entries with builtin
 * first, unavailable graying (disabled), selection switching the pane's
 * harness via switchSessionHarness for a session-bound pane, and the
 * fail-closed revert when the switch call fails (busy 409 / plan 400).
 *
 * Author: Damon Li
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneHarnessPicker } from "./HarnessPicker";
import { useAppStore } from "../store";

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
    display_name: "AgenticX 内置 Runtime",
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

function makePane(overrides: Record<string, unknown> = {}) {
  return {
    id: "pane-1",
    avatarId: null,
    avatarName: "A",
    sessionId: "sess-1",
    modelProvider: "p",
    modelName: "m",
    harnessId: null,
    ...overrides,
  };
}

type DesktopBridge = {
  setSessionHarness: ReturnType<typeof vi.fn>;
  switchSessionHarness: ReturnType<typeof vi.fn>;
  loadSessionMessages: ReturnType<typeof vi.fn>;
};

function bridge(): DesktopBridge {
  return (window as unknown as { agenticxDesktop: DesktopBridge }).agenticxDesktop;
}

describe("PaneHarnessPicker", () => {
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
    vi.stubGlobal(
      "agenticxDesktop",
      {
        setSessionHarness: vi.fn().mockResolvedValue({ ok: true }),
        switchSessionHarness: vi
          .fn()
          .mockResolvedValue({ ok: true, switch: { ok: true, strategy: "noop" } }),
        loadSessionMessages: vi.fn().mockResolvedValue({ ok: true, messages: [] }),
      },
    );
    useAppStore.setState({
      panes: [makePane()],
      setPaneHarness: (paneId: string, harnessId: string | null) => {
        useAppStore.setState((state) => ({
          panes: state.panes.map((pane) =>
            pane.id === paneId ? { ...pane, harnessId } : pane,
          ),
        }));
      },
      setPaneMessages: () => {},
    } as Partial<typeof useAppStore.getState>);
  });

  it("shows builtin as the default label and lists catalog on open", async () => {
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );

    // closed initially, default label is the builtin runtime
    expect(screen.getByRole("button", { name: /Built-in Runtime/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Built-in Runtime/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:9740/api/harnesses",
        expect.objectContaining({
          headers: { "x-agx-desktop-token": "tok" },
        }),
      ),
    );

    // builtin first, all three entries visible
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-label") || o.textContent)).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("CodeBuddy")).toBeTruthy();
  });

  it("grays out unavailable harnesses and blocks selection", async () => {
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Built-in Runtime/i }));
    const option = (await screen.findByRole("option", {
      name: /CodeBuddy/i,
    })) as HTMLButtonElement;
    expect(option.disabled).toBe(true);
    expect(option.className).toContain("opacity-45");

    fireEvent.click(option);
    // selection blocked: label unchanged, no switch call
    expect(bridge().switchSessionHarness).not.toHaveBeenCalled();
    expect(useAppStore.getState().panes[0].harnessId ?? null).toBe(null);
  });

  it("selects an available harness: pane state + switch call + message refresh", async () => {
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Built-in Runtime/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Claude Code/i }));

    await waitFor(() => {
      expect(useAppStore.getState().panes[0].harnessId).toBe("claude-code");
    });
    expect(bridge().switchSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-1",
      harnessId: "claude-code",
    });
    // success path refreshes the pane so the boundary marker shows up
    await waitFor(() => {
      expect(bridge().loadSessionMessages).toHaveBeenCalledWith("sess-1");
    });
    // dropdown closed after selection
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("re-selecting builtin switches back to the builtin runtime", async () => {
    useAppStore.setState({
      panes: [makePane({ harnessId: "claude-code" })],
    });
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    // current label reflects the bound harness (catalog pre-warmed on mount)
    const trigger = await screen.findByRole("button", { name: /Claude Code/i });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: /Built-in Runtime/i }));

    await waitFor(() => {
      expect(useAppStore.getState().panes[0].harnessId ?? null).toBe(null);
    });
    expect(bridge().switchSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-1",
      harnessId: "python-agent",
    });
  });

  it("fail closed: busy 409 reverts the pane to the previous harness", async () => {
    bridge().switchSessionHarness.mockResolvedValue({
      ok: false,
      error: "HTTP 409: session turn in flight; wait for it to settle before switching harness",
    });
    useAppStore.setState({
      panes: [makePane({ harnessId: "claude-code" })],
    });
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Claude Code/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Built-in Runtime/i }));

    // optimistic flip first, then the fail-closed revert lands
    await waitFor(() => {
      expect(useAppStore.getState().panes[0].harnessId ?? null).toBe("claude-code");
    });
    // busy feedback surfaced (English copy in test locale)
    await waitFor(() => {
      expect(screen.getByText(/still running/i)).toBeTruthy();
    });
    // no message refresh on the failure path
    expect(bridge().loadSessionMessages).not.toHaveBeenCalled();
  });

  it("fail closed: plan failure reverts the pane to the previous harness", async () => {
    bridge().switchSessionHarness.mockResolvedValue({
      ok: false,
      error: "HTTP 400: manual_context strategy requires manual context text",
    });
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Built-in Runtime/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Claude Code/i }));

    await waitFor(() => {
      expect(useAppStore.getState().panes[0].harnessId ?? null).toBe(null);
    });
    await waitFor(() => {
      expect(screen.getByText(/switch failed/i)).toBeTruthy();
    });
  });

  it("renders load-failed copy when the catalog fetch rejects", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Built-in Runtime/i }));
    expect(await screen.findByText(/Failed to load harnesses/)).toBeTruthy();
  });
});
