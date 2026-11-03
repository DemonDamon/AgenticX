// @vitest-environment jsdom
/**
 * PaneHarnessPicker component tests (harness-control-surface SP5a).
 *
 * Covers: catalog fetch + trigger label, dropdown entries with builtin
 * first, unavailable graying (disabled), selection updating pane state
 * and calling setSessionHarness for a session-bound pane.
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
    // selection blocked: label unchanged, no IPC call
    expect(
      (window as unknown as { agenticxDesktop: { setSessionHarness: ReturnType<typeof vi.fn> } })
        .agenticxDesktop.setSessionHarness,
    ).not.toHaveBeenCalled();
    expect(useAppStore.getState().panes[0].harnessId ?? null).toBe(null);
  });

  it("selects an available harness: pane state + session persistence call", async () => {
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
    expect(
      (window as unknown as { agenticxDesktop: { setSessionHarness: ReturnType<typeof vi.fn> } })
        .agenticxDesktop.setSessionHarness,
    ).toHaveBeenCalledWith({
      sessionId: "sess-1",
      harnessId: "claude-code",
    });
    // dropdown closed after selection
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("re-selecting builtin clears the binding", async () => {
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
    expect(
      (window as unknown as { agenticxDesktop: { setSessionHarness: ReturnType<typeof vi.fn> } })
        .agenticxDesktop.setSessionHarness,
    ).toHaveBeenCalledWith({
      sessionId: "sess-1",
      harnessId: "python-agent",
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
