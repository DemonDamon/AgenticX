// @vitest-environment jsdom
/**
 * PreferredHarnessPicker enum + PaneHarnessPicker + preferred-harness util tests.
 *
 * Covers: Settings default persistence (picker itself does not switch),
 * in-chat hot switch via switchSessionHarness, handoff-failure fallback,
 * in-flight no-fallback, Settings not rewriting existing panes, and
 * the chip unlocking even when message refresh hangs.
 *
 * Author: Damon Li
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneHarnessPicker, PreferredHarnessPicker } from "./HarnessPicker";
import { useAppStore } from "../store";
import {
  BUILTIN_HARNESS_ID,
  bindPreferredHarnessToSession,
  ensureSessionFollowsPreferredHarness,
  ensureSessionHarness,
  normalizePreferredHarnessId,
  paneFollowsPreferredHarness,
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

function makePane(overrides: Record<string, unknown> = {}) {
  return {
    id: "pane-1",
    avatarId: null,
    avatarName: "A",
    sessionId: "sess-1",
    modelProvider: "p",
    modelName: "m",
    harnessId: null,
    harnessFollowsPreference: true,
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

  it("treats unset follow flag as following the Settings default", () => {
    expect(paneFollowsPreferredHarness({})).toBe(true);
    expect(paneFollowsPreferredHarness({ harnessFollowsPreference: true })).toBe(true);
    expect(paneFollowsPreferredHarness({ harnessFollowsPreference: false })).toBe(false);
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

  it("ensureSessionFollowsPreferredHarness switches an existing session", async () => {
    const setPaneHarness = vi.fn();
    const switchSessionHarness = vi.fn().mockResolvedValue({ ok: true });
    const setSessionHarness = vi.fn();
    const ok = await ensureSessionFollowsPreferredHarness("pane-1", "sess-old", {
      getPreferredHarnessId: () => "codebuddy",
      setPaneHarness,
      switchSessionHarness,
      setSessionHarness,
    });
    expect(ok).toBe(true);
    expect(switchSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-old",
      harnessId: "codebuddy",
    });
    expect(setPaneHarness).toHaveBeenCalledWith("pane-1", "codebuddy");
    expect(setSessionHarness).not.toHaveBeenCalled();
  });

  it("ensureSessionFollowsPreferredHarness unbinds via python-agent", async () => {
    const setPaneHarness = vi.fn();
    const switchSessionHarness = vi.fn().mockResolvedValue({ ok: true });
    const setSessionHarness = vi.fn();
    const ok = await ensureSessionFollowsPreferredHarness("pane-1", "sess-old", {
      getPreferredHarnessId: () => null,
      setPaneHarness,
      switchSessionHarness,
      setSessionHarness,
    });
    expect(ok).toBe(true);
    expect(switchSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-old",
      harnessId: BUILTIN_HARNESS_ID,
    });
    expect(setPaneHarness).toHaveBeenCalledWith("pane-1", null);
    expect(setSessionHarness).not.toHaveBeenCalled();
  });

  it("falls back to setSessionHarness when switch fails", async () => {
    const setPaneHarness = vi.fn();
    const switchSessionHarness = vi.fn().mockResolvedValue({
      ok: false,
      error: "handoff failed",
    });
    const setSessionHarness = vi.fn().mockResolvedValue({ ok: true });
    const ok = await ensureSessionFollowsPreferredHarness("pane-1", "sess-old", {
      getPreferredHarnessId: () => "codebuddy",
      setPaneHarness,
      switchSessionHarness,
      setSessionHarness,
    });
    expect(ok).toBe(true);
    expect(setSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-old",
      harnessId: "codebuddy",
    });
    expect(setPaneHarness).toHaveBeenCalledWith("pane-1", "codebuddy");
  });

  it("does not fallback when a harness turn is already in flight", async () => {
    const setPaneHarness = vi.fn();
    const switchSessionHarness = vi.fn().mockResolvedValue({
      ok: false,
      error: "session sess-old has a harness turn in flight; switch after it settles",
    });
    const setSessionHarness = vi.fn();
    const ok = await ensureSessionFollowsPreferredHarness("pane-1", "sess-old", {
      getPreferredHarnessId: () => "codebuddy",
      setPaneHarness,
      switchSessionHarness,
      setSessionHarness,
    });
    expect(ok).toBe(false);
    expect(setSessionHarness).not.toHaveBeenCalled();
    expect(setPaneHarness).not.toHaveBeenCalled();
  });

  it("ensureSessionHarness follows the pane target rather than Settings", async () => {
    const setPaneHarness = vi.fn();
    const switchSessionHarness = vi.fn().mockResolvedValue({ ok: true });
    const setSessionHarness = vi.fn();
    const ok = await ensureSessionHarness("pane-1", "sess-old", {
      getTargetHarnessId: () => "codebuddy",
      setPaneHarness,
      switchSessionHarness,
      setSessionHarness,
    });
    expect(ok).toBe(true);
    expect(switchSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-old",
      harnessId: "codebuddy",
    });
    expect(setPaneHarness).toHaveBeenCalledWith("pane-1", "codebuddy");
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
    vi.stubGlobal("agenticxDesktop", {
      setSessionHarness: vi.fn().mockResolvedValue({ ok: true }),
      switchSessionHarness: vi
        .fn()
        .mockResolvedValue({ ok: true, switch: { ok: true, strategy: "noop" } }),
      loadSessionMessages: vi.fn().mockResolvedValue({ ok: true, messages: [] }),
    });
    useAppStore.setState({
      preferredHarnessId: null,
      panes: [makePane()],
      setPaneHarness: (paneId: string, harnessId: string | null, followPreference?: boolean) => {
        useAppStore.setState((state) => ({
          panes: state.panes.map((pane) =>
            pane.id === paneId
              ? {
                  ...pane,
                  harnessId,
                  ...(followPreference !== undefined
                    ? { harnessFollowsPreference: followPreference }
                    : {}),
                }
              : pane,
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
    expect(useAppStore.getState().panes[0].harnessFollowsPreference).toBe(false);
    expect(bridge().switchSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-1",
      harnessId: "claude-code",
    });
    await waitFor(() => {
      expect(bridge().loadSessionMessages).toHaveBeenCalledWith("sess-1");
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("re-selecting builtin switches back to the builtin runtime", async () => {
    useAppStore.setState({
      panes: [makePane({ harnessId: "claude-code", harnessFollowsPreference: false })],
    });
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    const trigger = await screen.findByRole("button", { name: /Claude Code/i });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: /Built-in Runtime/i }));

    await waitFor(() => {
      expect(useAppStore.getState().panes[0].harnessId ?? null).toBe(null);
    });
    expect(useAppStore.getState().panes[0].harnessFollowsPreference).toBe(true);
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
      panes: [makePane({ harnessId: "claude-code", harnessFollowsPreference: false })],
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

    await waitFor(() => {
      expect(useAppStore.getState().panes[0].harnessId ?? null).toBe("claude-code");
    });
    expect(bridge().setSessionHarness).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/still running/i)).toBeTruthy();
    });
    expect(bridge().loadSessionMessages).not.toHaveBeenCalled();
  });

  it("falls back to setSessionHarness when handoff fails", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Built-in Runtime/i }));
    fireEvent.click(await screen.findByRole("option", { name: /Claude Code/i }));

    await waitFor(() => {
      expect(useAppStore.getState().panes[0].harnessId).toBe("claude-code");
    });
    expect(bridge().setSessionHarness).toHaveBeenCalledWith({
      sessionId: "sess-1",
      harnessId: "claude-code",
    });
    await waitFor(() => {
      expect(bridge().loadSessionMessages).toHaveBeenCalledWith("sess-1");
    });
  });

  it("fail closed: handoff and rebind both failing reverts the pane", async () => {
    bridge().switchSessionHarness.mockResolvedValue({
      ok: false,
      error: "HTTP 400: manual_context strategy requires manual context text",
    });
    bridge().setSessionHarness.mockResolvedValue({
      ok: false,
      error: "rebind failed",
    });
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

  it("optimistically updates the chip label before switch resolves", async () => {
    let resolveSwitch: (value: { ok: boolean }) => void = () => {};
    bridge().switchSessionHarness.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSwitch = resolve;
        }),
    );
    useAppStore.setState({
      panes: [makePane({ harnessId: "claude-code", harnessFollowsPreference: false })],
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
    expect(await screen.findByRole("button", { name: /Built-in Runtime/i })).toBeTruthy();
    expect(screen.getByText(/Switching engine/i)).toBeTruthy();
    resolveSwitch({ ok: true });
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Built-in Runtime/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it("re-enables the chip even when loadSessionMessages hangs", async () => {
    bridge().loadSessionMessages.mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      }),
    );
    useAppStore.setState({
      panes: [makePane({ harnessId: "claude-code", harnessFollowsPreference: false })],
    });
    render(
      <PaneHarnessPicker
        paneId="pane-1"
        apiBase="http://127.0.0.1:9740"
        apiToken="tok"
      />,
    );
    const trigger = await screen.findByRole("button", { name: /Claude Code/i });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: /Built-in Runtime/i }));

    await waitFor(() => {
      expect(useAppStore.getState().panes[0].harnessId ?? null).toBe(null);
    });
    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /Built-in Runtime/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

});

describe("setPreferredHarnessId sticky sessions", () => {
  const originalSetPreferredHarnessId = useAppStore.getState().setPreferredHarnessId;

  beforeEach(() => {
    useAppStore.setState({
      setPreferredHarnessId: originalSetPreferredHarnessId,
    } as Partial<typeof useAppStore.getState>);
  });

  it("updates the Settings default without rewriting existing panes", () => {
    const following = makePane({
      id: "pane-follow",
      harnessId: "claude-code",
      harnessFollowsPreference: true,
    });
    const pinned = makePane({
      id: "pane-pinned",
      harnessId: "claude-code",
      harnessFollowsPreference: false,
    });
    useAppStore.setState({
      preferredHarnessId: "claude-code",
      panes: [following, pinned] as typeof useAppStore.getState extends () => infer S ? S["panes"] : never,
    });
    useAppStore.getState().setPreferredHarnessId("codebuddy");
    const panes = useAppStore.getState().panes;
    expect(panes.find((p) => p.id === "pane-follow")?.harnessId).toBe("claude-code");
    expect(panes.find((p) => p.id === "pane-pinned")?.harnessId).toBe("claude-code");
    expect(useAppStore.getState().preferredHarnessId).toBe("codebuddy");
  });
});
