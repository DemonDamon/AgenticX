import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/i18n";
import { AvatarSidebar } from "./AvatarSidebar";

const state = vi.hoisted(() => ({
  mainView: "chat",
  panes: [{ id: "pane-meta", avatarId: null as string | null, sessionId: "s1" }],
  activePaneId: "pane-meta",
  setMainView: vi.fn(),
  setAvatars: vi.fn(),
  setGroups: vi.fn(),
  openProject: vi.fn(),
}));

vi.mock("../store", () => ({
  useAppStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

vi.mock("../hooks/usePaneNavigation", () => ({
  usePaneNavigation: () => ({
    openMetaOrAvatarPane: () => undefined,
    newMetaTask: () => undefined,
  }),
}));

vi.mock("./sidebar/SidebarSessionHistory", () => ({
  SidebarSessionHistory: () => null,
}));

vi.mock("./SidebarAccountBar", () => ({
  SidebarAccountBar: () => null,
}));

vi.mock("./AvatarSettingsPanel", () => ({
  AvatarSettingsPanel: () => null,
}));

vi.mock("./TopbarLeftControls", () => ({
  TopbarLeftControls: () => null,
}));

vi.mock("./quick-compose/SidebarCreateButton", () => ({
  SidebarCreateButton: () => null,
}));

describe("AvatarSidebar navigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("shows project collaboration and hides the expert-group nav entry", () => {
    const html = renderToStaticMarkup(<AvatarSidebar onToggleSidebar={() => undefined} />);
    expect(html).toContain("项目协作");
    expect(html).not.toContain("专家群聊");
  });
});
