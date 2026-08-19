import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type TestPane = {
  id: string;
  avatarId: string | null;
  avatarName: string;
  sessionId: string;
  messages: Array<{ id: string; role: string; content: string }>;
};

type TestStore = {
  panes: TestPane[];
  activePaneId: string;
  activeAvatarId: string | null;
  mainView: string;
  addPane: ReturnType<typeof vi.fn>;
  setActivePaneId: ReturnType<typeof vi.fn>;
  setActiveAvatarId: ReturnType<typeof vi.fn>;
  setPaneSessionId: ReturnType<typeof vi.fn>;
  setMainView: ReturnType<typeof vi.fn>;
};

const navStore = vi.hoisted(() => ({
  state: {} as TestStore,
}));

vi.mock("../store", () => {
  const useAppStore = Object.assign(
    (selector: (state: TestStore) => unknown) => selector(navStore.state),
    { getState: () => navStore.state },
  );
  return { useAppStore };
});

import { usePaneNavigation } from "./usePaneNavigation";
import {
  clearPaneAwaitingFreshSession,
  isPaneAwaitingFreshSession,
} from "../utils/pane-fresh-session";

type PaneNavigation = ReturnType<typeof usePaneNavigation>;

function pane(overrides: Partial<TestPane> = {}): TestPane {
  return {
    id: "pane-meta",
    avatarId: null,
    avatarName: "和创智派",
    sessionId: "",
    messages: [],
    ...overrides,
  };
}

function renderNavigation(): PaneNavigation {
  let navigation: PaneNavigation | undefined;
  function Harness() {
    navigation = usePaneNavigation();
    return null;
  }
  renderToStaticMarkup(<Harness />);
  if (!navigation) throw new Error("navigation hook did not render");
  return navigation;
}

describe("usePaneNavigation expert conversations", () => {
  const dispatchEvent = vi.fn<(event: Event) => boolean>(() => true);
  const listSessions = vi.fn(() => Promise.resolve({ ok: true, sessions: [] }));

  beforeEach(() => {
    clearPaneAwaitingFreshSession("pane-expert-finance-new");
    clearPaneAwaitingFreshSession("pane-expert");
    dispatchEvent.mockClear();
    listSessions.mockClear();
    vi.stubGlobal("window", {
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
      dispatchEvent,
      agenticxDesktop: { listSessions },
    });

    const state = {
      panes: [pane()],
      activePaneId: "pane-meta",
      activeAvatarId: null,
      mainView: "avatars",
    } as TestStore;
    state.addPane = vi.fn((avatarId: string | null, avatarName: string, sessionId: string) => {
      const id = `pane-${avatarId ?? "meta"}-new`;
      state.panes.push(pane({ id, avatarId, avatarName, sessionId }));
      state.activePaneId = id;
      return id;
    });
    state.setActivePaneId = vi.fn((id: string) => {
      state.activePaneId = id;
    });
    state.setActiveAvatarId = vi.fn((id: string | null) => {
      state.activeAvatarId = id;
    });
    state.setPaneSessionId = vi.fn((paneId: string, sessionId: string) => {
      const target = state.panes.find((item) => item.id === paneId);
      if (target) target.sessionId = sessionId;
    });
    state.setMainView = vi.fn((view: string) => {
      state.mainView = view;
    });
    navStore.state = state;
  });

  it("opens a never-opened expert as a lazy fresh topic without listing or creating sessions", () => {
    const navigation = renderNavigation();

    navigation.openMetaOrAvatarPane("expert-finance", "数字专家");

    const state = navStore.state;
    const expertPane = state.panes.find((item) => item.avatarId === "expert-finance");
    expect(expertPane).toMatchObject({
      avatarName: "数字专家",
      sessionId: "",
      messages: [],
    });
    expect(state.activePaneId).toBe(expertPane?.id);
    expect(state.activeAvatarId).toBe("expert-finance");
    expect(state.mainView).toBe("chat");
    expect(listSessions).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(isPaneAwaitingFreshSession(expertPane?.id ?? "")).toBe(true);
  });

  it("prefills an editable draft after mounting a never-opened expert pane", () => {
    const navigation = renderNavigation();

    navigation.openMetaOrAvatarPane(
      "expert-finance",
      "数字专家",
      "请先检查工作区依赖，不要自动安装。",
    );

    const expertPane = navStore.state.panes.find(
      (item) => item.avatarId === "expert-finance",
    );
    expect(expertPane?.sessionId).toBe("");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]![0] as CustomEvent<{
      paneId?: string;
      draftText?: string;
    }>;
    expect(event.type).toBe("agenticx:pane:new-topic");
    expect(event.detail).toEqual({
      paneId: expertPane?.id,
      draftText: "请先检查工作区依赖，不要自动安装。",
    });
  });

  it("turns an already-open expert pane into a fresh topic instead of resuming its old session", () => {
    navStore.state.panes.push(
      pane({
        id: "pane-expert",
        avatarId: "expert-finance",
        avatarName: "数字专家",
        sessionId: "session-old",
        messages: [{ id: "old-user", role: "user", content: "旧对话" }],
      }),
    );
    const navigation = renderNavigation();

    navigation.openMetaOrAvatarPane("expert-finance", "数字专家");

    const state = navStore.state;
    expect(state.panes.filter((item) => item.avatarId === "expert-finance")).toHaveLength(1);
    expect(state.activePaneId).toBe("pane-expert");
    expect(listSessions).not.toHaveBeenCalled();
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]![0] as CustomEvent<{ paneId?: string }>;
    expect(event.type).toBe("agenticx:pane:new-topic");
    expect(event.detail).toEqual({ paneId: "pane-expert" });
  });

  it("passes an editable draft to an already-open expert's fresh topic", () => {
    navStore.state.panes.push(
      pane({
        id: "pane-expert",
        avatarId: "expert-finance",
        avatarName: "数字专家",
        sessionId: "session-old",
      }),
    );
    const navigation = renderNavigation();

    navigation.openMetaOrAvatarPane(
      "expert-finance",
      "数字专家",
      "环境配置向导草稿",
    );

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]![0] as CustomEvent<{
      paneId?: string;
      draftText?: string;
    }>;
    expect(event.detail).toEqual({
      paneId: "pane-expert",
      draftText: "环境配置向导草稿",
    });
  });

  it("does not reinterpret the meta-agent entry as an expert new-topic action", () => {
    const navigation = renderNavigation();

    navigation.openMetaOrAvatarPane(null, "和创智派");

    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(listSessions).toHaveBeenCalledWith(undefined);
  });
});
