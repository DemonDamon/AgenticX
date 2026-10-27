// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { useAppStore, type ChatPane } from "../../store";
import { clearEnterpriseAgentDetailCache, rememberManagedSession } from "../../utils/ma-pane";

const AGENT = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const ENV = "01JQMZ8K3N4P5Q6R7S8T9VWXY0";
const SID = "01HMASESSION0000000000000A";

const harness = vi.hoisted(() => ({
  status: "idle" as "idle" | "running" | "requires_action",
  interactiveStatus: 200,
  detail: null as unknown,
  payloads: [] as Array<{ agentId: string; environmentId?: string; title?: string }>,
  order: [] as string[],
  create: null as null | ((payload: { agentId: string; environmentId?: string; title?: string }) => Promise<unknown>),
  getSession: null as null | ((sessionId: string) => Promise<unknown>),
  interrupt: vi.fn(async () => undefined),
}));

vi.mock("../../hooks/useManagedSession", () => ({
  useManagedSession: (sessionId: string | null) => ({
    ready: Boolean(sessionId),
    error: null,
    connection: sessionId ? "open" : "closed",
    transcript: {
      sessionId: sessionId ?? "",
      lastSeq: 0,
      status: harness.status,
      stopReason: null,
      rows: [],
      toolIndex: {},
      resolved: {},
      pendingReasoning: "",
      liveText: "",
      interrupted: false,
      usage: null,
    },
    messages: [] as Array<{ role: string; content: string }>,
    sendMessage: async (text: string) => {
      const res = await window.agenticxDesktop.maPostEvents(String(sessionId ?? ""), [{
        type: "user.message",
        content: [{ type: "text", text }],
      }]);
      if (!res.ok) return { ok: false as const, code: res.code, message: res.message };
      return { ok: true as const };
    },
    interrupt: () => harness.interrupt(),
    resolveApproval: async () => ({ ok: true }),
    retry: () => undefined,
  }),
}));

vi.mock("../../utils/studio-fetch", () => ({
  studioFetch: async (path: string, init?: RequestInit) => {
    if (String(path).includes("interactive-environments")) {
      harness.order.push(`post ${String(init?.body ?? "")}`);
      return new Response("{}", { status: harness.interactiveStatus, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(harness.detail), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
}));

vi.mock("../ChatPane", () => ({
  ChatPane: () => <div data-testid="chat-pane" />,
}));

import { ManagedChatPane } from "./ManagedChatPane";
import { PaneManager } from "../PaneManager";

const seedPane: ChatPane = useAppStore.getState().panes[0]!;
const posted: Array<{ sessionId: string; events: unknown[] }> = [];

function cloudDetail(patch: Record<string, unknown> = {}) {
  return {
    agent: {
      id: AGENT,
      slug: "report-bot",
      displayName: "报告助手",
      description: "周报",
      runtime: "cloud",
      model: "openai/gpt-4o",
      origin: "enterprise",
      systemPrompt: "你是报告助手",
      latestVersion: 3,
      effectiveVersion: 2,
      routingMode: "pinned",
      defaultEnvironment: null,
      executionTarget: "cloud",
      ownedByMe: false,
      ...patch,
    },
    version: {
      version: 2,
      createdAt: "2026-10-26T08:00:00.000Z",
      note: "加工具",
      summary: {
        model: "openai/gpt-4o",
        system: "你是报告助手",
        builtin: null,
        mcp: [],
        custom: [],
        skills: [],
        maxToolRounds: 40,
        welcomeMessage: "欢迎使用报告助手",
        suggestedQuestions: ["本周报告？"],
      },
    },
  };
}

function desktopDetail() {
  return cloudDetail({
    runtime: "desktop_worker",
    executionTarget: "desktop_worker",
    defaultEnvironment: { id: ENV, name: "研发桌面", type: "desktop_worker" },
  });
}

function maPane(sessionId = ""): ChatPane {
  return {
    ...seedPane,
    id: "pane-ma",
    avatarId: `ma:${AGENT}`,
    avatarName: "报告助手",
    sessionId,
    messages: [],
  };
}

function renderPane() {
  return render(<ManagedChatPane paneId="pane-ma" focused onFocus={() => undefined} />);
}

async function typeAndSend(text: string) {
  const box = await screen.findByRole("textbox");
  await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
  return box;
}

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

beforeEach(async () => {
  vi.stubGlobal("localStorage", memoryStorage());
  harness.status = "idle";
  harness.interactiveStatus = 200;
  harness.detail = cloudDetail();
  harness.payloads = [];
  harness.order = [];
  harness.create = null;
  harness.getSession = null;
  harness.interrupt.mockClear();
  posted.length = 0;
  clearEnterpriseAgentDetailCache();
  await i18n.changeLanguage("zh");
  useAppStore.setState({
    panes: [{ ...seedPane, id: "pane-meta", avatarId: null, sessionId: "" }],
    activePaneId: "pane-meta",
    mainView: "chat",
  });
  Object.assign(window, {
    agenticxDesktop: {
      getApiAuthToken: async () => "desktop-token",
      maCreateSession: (payload: { agentId: string; environmentId?: string; title?: string }) => {
        harness.order.push("create");
        harness.payloads.push(payload);
        if (harness.create) return harness.create(payload);
        return Promise.resolve({ ok: true, status: 201, data: { id: SID, agent_version: 2 } });
      },
      maGetSession: (sessionId: string) => {
        if (harness.getSession) return harness.getSession(sessionId);
        return Promise.resolve({
          ok: true,
          status: 200,
          data: { id: sessionId, agent_version: 2, environment_id: null },
        });
      },
      maPostEvents: async (sessionId: string, events: unknown[]) => {
        posted.push({ sessionId, events });
        return { ok: true, status: 200, data: {} };
      },
      maListEvents: async () => ({ ok: true, status: 200, data: { data: [], has_more: false, next_after_seq: 0 } }),
      maStreamOpen: async () => ({ ok: true }),
      maStreamClose: async () => ({ ok: true }),
      onMaStreamFrame: () => () => undefined,
      onMaStreamState: () => () => undefined,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ManagedChatPane", () => {
  it("creates a cloud session on first send", async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    harness.create = () => new Promise((resolve) => {
      resolveCreate = resolve;
    });
    useAppStore.setState({ panes: [maPane("")], activePaneId: "pane-ma" });
    renderPane();
    const box = await typeAndSend("你好");
    await waitFor(() => expect(harness.payloads).toHaveLength(1));
    expect(box).toHaveProperty("value", "");
    expect(screen.getByText("你好")).toBeTruthy();
    expect(harness.payloads[0]).toEqual({ agentId: AGENT, environmentId: undefined, title: "报告助手" });
    await act(async () => {
      resolveCreate({ ok: true, status: 201, data: { id: SID, agent_version: 2 } });
    });
    await waitFor(() => {
      expect(useAppStore.getState().panes.find((pane) => pane.id === "pane-ma")?.sessionId).toBe(SID);
    });
    const stored = JSON.parse(localStorage.getItem("agx-ma-last-session-v1") || "{}") as Record<string, { sessionId: string }>;
    expect(stored[AGENT]?.sessionId).toBe(SID);
    await waitFor(() => {
      expect(posted.some((item) => item.sessionId === SID && JSON.stringify(item.events).includes("user.message"))).toBe(true);
    });
  });

  it("registers interactive environment before creating a desktop session", async () => {
    harness.detail = desktopDetail();
    let resolveCreate: (value: unknown) => void = () => undefined;
    harness.create = () => new Promise((resolve) => {
      resolveCreate = resolve;
    });
    useAppStore.setState({ panes: [maPane("")], activePaneId: "pane-ma" });
    const first = renderPane();
    await typeAndSend("你好");
    await waitFor(() => expect(harness.order).toContain("create"));
    const postIndex = harness.order.findIndex((item) => item.startsWith("post "));
    expect(postIndex).toBeGreaterThanOrEqual(0);
    expect(harness.order.indexOf("create")).toBeGreaterThan(postIndex);
    expect(harness.order[postIndex]).toContain(`"environment_id":"${ENV}"`);
    expect(harness.payloads[0]?.environmentId).toBe(ENV);
    first.unmount();

    harness.interactiveStatus = 409;
    harness.order = [];
    harness.payloads = [];
    harness.detail = desktopDetail();
    clearEnterpriseAgentDetailCache();
    useAppStore.setState({ panes: [maPane("")], activePaneId: "pane-ma" });
    renderPane();
    const box = await typeAndSend("你好");
    await waitFor(() => expect(screen.getByText("请先登录企业账号")).toBeTruthy());
    expect(harness.payloads).toHaveLength(0);
    expect(box).toHaveProperty("value", "你好");
    resolveCreate({ ok: true, status: 201, data: { id: SID, agent_version: 2 } });
  });

  it("maps create errors", async () => {
    useAppStore.setState({ panes: [maPane("")], activePaneId: "pane-ma" });
    renderPane();
    harness.create = async () => ({ ok: false, status: 404, code: "environment_not_found", message: "x" });
    await typeAndSend("你好");
    expect(await screen.findByText("你的电脑不在该智能体的执行名单中")).toBeTruthy();
    harness.create = async () => ({ ok: false, status: 403, code: "forbidden_scope", message: "x" });
    await typeAndSend("再试");
    expect(await screen.findByText("企业尚未开放桌面托管会话，请联系管理员")).toBeTruthy();
  });

  it("drops a stale remembered session", async () => {
    rememberManagedSession(AGENT, SID);
    harness.getSession = async () => ({ ok: false, status: 404, code: "session_not_found", message: "missing" });
    useAppStore.setState({ panes: [maPane(SID)], activePaneId: "pane-ma" });
    renderPane();
    expect(await screen.findByText("欢迎使用报告助手")).toBeTruthy();
    await waitFor(() => {
      expect(useAppStore.getState().panes.find((pane) => pane.id === "pane-ma")?.sessionId).toBe("");
    });
    const stored = JSON.parse(localStorage.getItem("agx-ma-last-session-v1") || "{}") as Record<string, unknown>;
    expect(stored[AGENT]).toBeUndefined();
  });

  it("shows stop while running and blocks input on requires_action", async () => {
    harness.status = "running";
    useAppStore.setState({ panes: [maPane(SID)], activePaneId: "pane-ma" });
    const view = renderPane();
    fireEvent.click(await screen.findByRole("button", { name: "停止" }));
    expect(harness.interrupt).toHaveBeenCalled();
    harness.status = "requires_action";
    view.rerender(<ManagedChatPane paneId="pane-ma" focused onFocus={() => undefined} />);
    expect(screen.getByPlaceholderText("请先处理待审批的工具调用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送" })).toHaveProperty("disabled", true);
  });

  it("header shows enterprise identity", async () => {
    useAppStore.setState({ panes: [maPane("")], activePaneId: "pane-ma" });
    renderPane();
    expect(await screen.findByText("v2")).toBeTruthy();
    expect(screen.getByText("企业")).toBeTruthy();
    expect(screen.getByText("报告助手")).toBeTruthy();
    expect(screen.queryByText("分身")).toBeNull();
  });

  it("warns when local execution does not start", async () => {
    vi.useFakeTimers();
    harness.detail = desktopDetail();
    harness.status = "idle";
    useAppStore.setState({ panes: [maPane(SID)], activePaneId: "pane-ma" });
    renderPane();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("本机执行尚未开始，请在设置 → 企业 Worker 查看状态")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText("本机执行尚未开始，请在设置 → 企业 Worker 查看状态")).toBeTruthy();
  });

  it("PaneManager renders ManagedChatPane for ma panes", async () => {
    useAppStore.setState({
      panes: [
        { ...seedPane, id: "pane-meta", avatarId: null, avatarName: "Machi", sessionId: "local-session" },
        maPane(""),
      ],
      activePaneId: "pane-ma",
      mainView: "chat",
    });
    render(
      <PaneManager
        onOpenConfirm={async () => false}
      />,
    );
    expect(await screen.findByTestId("managed-chat-pane")).toBeTruthy();
    expect(screen.getAllByTestId("chat-pane")).toHaveLength(1);
  });
});
