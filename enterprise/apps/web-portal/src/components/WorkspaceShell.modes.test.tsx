import * as React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, mount, setSegments, setViewport } from "../../../../features/chat/src/__tests__/viewport-test-utils";

const mocks = vi.hoisted(() => {
  const state = {
    sessions: [], activeSessionId: "session", activeModel: "model", messages: [], historyLoading: false,
    createSession: vi.fn(), switchSession: vi.fn(), renameSession: vi.fn(), pinSession: vi.fn(),
    deleteSession: vi.fn(), deleteSessions: vi.fn(), streamStateBySessionId: {}, setHistoryPrincipal: vi.fn(),
  };
  return { state, push: vi.fn(), replace: vi.fn(), setTheme: vi.fn(), setLocale: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@agenticx/sdk-ts", () => ({ HttpChatClient: class {}, MockChatClient: class {} }));
vi.mock("@agenticx/feature-chat", async () => {
  const viewport = await import("../../../../features/chat/src/hooks/useUsableViewport");
  const geometry = await import("../../../../features/chat/src/utils/usable-viewport");
  return {
    ...viewport, ...geometry,
    ChatLocaleProvider: ({ children }: { children: React.ReactNode }) => children,
    useChatStore: Object.assign((selector: (state: typeof mocks.state) => unknown) => selector(mocks.state), { getState: () => mocks.state }),
    createPortalChatHistoryClient: vi.fn(() => ({})), disposeHistoryOutbox: vi.fn(), startHistoryOutboxCoordinator: vi.fn(),
  };
});
vi.mock("@agenticx/ui", async () => {
  const React = await import("react");
  const Block = ({ children, className }: { children?: React.ReactNode; className?: string }) => <div className={className}>{children}</div>;
  const Button = ({ children, onClick, className, "aria-label": label }: { children?: React.ReactNode; onClick?: () => void; className?: string; "aria-label"?: string }) => <button onClick={onClick} className={className} aria-label={label}>{children}</button>;
  return {
    Badge: Block, Button, DropdownMenu: Block, DropdownMenuContent: Block, DropdownMenuItem: Button, DropdownMenuLabel: Block,
    DropdownMenuSeparator: Block, DropdownMenuTrigger: Block, MachiAvatar: Block, Separator: Block, Toaster: Block,
    Tooltip: Block, TooltipContent: Block, TooltipProvider: Block, TooltipTrigger: Block, toast: { error: vi.fn() },
    useLocale: () => ({ locale: "en", setLocale: mocks.setLocale }),
    useUiTheme: () => ({ theme: "light", resolved: "light", setTheme: mocks.setTheme, toggle: vi.fn() }),
  };
});
vi.mock("../lib/session-keepalive", () => ({ shouldRenewVisibleSession: () => false, refreshSessionKeepalive: vi.fn() }));
vi.mock("./MachiChatView", () => ({ MachiChatView: () => <div data-testid="chat-mode"><textarea /></div> }));
vi.mock("./QuotaCard", () => ({ QuotaCard: () => null }));
vi.mock("./settings/SettingsPanel", () => ({ SettingsPanel: () => <div data-testid="settings-mode">Settings</div> }));
vi.mock("./HistorySessionsPanel", () => ({ HistorySessionsPanel: () => null }));
import { WorkspaceShell } from "./WorkspaceShell";

describe("workspace modes within the usable viewport", () => {
  let view: Awaited<ReturnType<typeof mount>> | undefined;
  beforeEach(() => {
    setViewport(1200, 800);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }));
    window.localStorage.clear();
    mocks.push.mockClear();
  });
  afterEach(async () => { await view?.unmount(); view = undefined; vi.unstubAllGlobals(); });

  it("keeps chat, settings, rooms and projects navigation", async () => {
    view = await mount(<WorkspaceShell userEmail="person@example.invalid" userScopes={[]} />);
    expect(view.container.querySelector("[data-testid=chat-mode]")).not.toBeNull();
    await click(view.container.querySelector("[aria-label=collabRoom]")); expect(mocks.push).toHaveBeenCalledWith("/rooms");
    await click(view.container.querySelector("[aria-label=myProjects]")); expect(mocks.push).toHaveBeenCalledWith("/projects");
    const settings = Array.from(view.container.querySelectorAll("button")).find((node) => node.textContent === "settings")!;
    await click(settings); expect(view.container.querySelector("[data-testid=settings-mode]")).not.toBeNull();
    const back = Array.from(view.container.querySelectorAll("button")).find((node) => node.textContent === "backToChat")!;
    await click(back); expect(view.container.querySelector("[data-testid=chat-mode]")).not.toBeNull();
  });

  it("uses a narrow fold segment for compact mode even on a wide display", async () => {
    setSegments([{ left: 0, top: 0, width: 580, height: 800 }, { left: 620, top: 0, width: 580, height: 800 }]);
    view = await mount(<WorkspaceShell userEmail="person@example.invalid" userScopes={[]} />);
    const main = view.container.querySelector<HTMLElement>("main")!;
    expect(main.dataset.compact).toBe("true");
    expect(main.style.getPropertyValue("--chat-viewport-width")).toBe("580px");
    const sidebar = view.container.querySelector("aside")!;
    expect(sidebar.className).toContain("absolute");
    await click(view.container.querySelector("[aria-label=openMenu]"));
    expect(sidebar.getAttribute("data-mobile-open")).toBe("1");
    setSegments(null);
    await act(async () => { window.dispatchEvent(new Event("resize")); await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(main.dataset.compact).toBe("false");
    expect(sidebar.className).toContain("relative");
  });
});
