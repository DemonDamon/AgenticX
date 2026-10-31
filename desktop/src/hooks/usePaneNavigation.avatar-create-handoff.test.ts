// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { i18n } from "../i18n/i18n";
import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { useAppStore } from "../store";
import { getComposerDraftText } from "../utils/composer-draft-store";
import { usePaneNavigation } from "./usePaneNavigation";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("usePaneNavigation avatar create handoff", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("agenticxDesktop", { getBackendScopeSync: () => "local" });
    const defaultPane = useAppStore.getState().panes[0];
    useAppStore.setState({
      mainView: "avatars",
      panes: defaultPane ? [{ ...defaultPane, avatarId: null, avatarName: META_AGENT_DISPLAY_NAME }] : [],
      activePaneId: defaultPane?.id ?? "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("wires gallery handoff through newMetaTask (source contract)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const nav = readFileSync(join(here, "usePaneNavigation.ts"), "utf8");
    const gallery = readFileSync(
      join(here, "../components/gallery/AvatarGalleryView.tsx"),
      "utf8",
    );
    expect(nav).toContain("prepareFreshComposerPaneDraft(targetPaneId, trimmedDraft)");
    expect(nav).toContain("draftHandoffNotice");
    expect(gallery).toContain("draftHandoffNotice: true");
  });

  it("switches to chat, persists pane draft, and dispatches new-topic with handoff notice", () => {
    const events: CustomEvent[] = [];
    const onNewTopic = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("agenticx:pane:new-topic", onNewTopic);

    const paneId = useAppStore.getState().panes[0]?.id ?? "";
    const draft = "帮我创建一个数字分身。\n\n我的需求：\n项目经理助手";

    const { result } = renderHook(() => usePaneNavigation());
    act(() => {
      result.current.newMetaTask(draft, { draftHandoffNotice: true });
    });

    expect(useAppStore.getState().mainView).toBe("chat");
    expect(getComposerDraftText(`pane:${paneId}`)).toContain("项目经理助手");

    act(() => {
      vi.runAllTimers();
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[events.length - 1]?.detail as {
      paneId?: string;
      draftText?: string;
      draftHandoffNotice?: boolean;
    };
    expect(last.paneId).toBe(paneId);
    expect(last.draftText).toContain("项目经理助手");
    expect(last.draftHandoffNotice).toBe(true);

    window.removeEventListener("agenticx:pane:new-topic", onNewTopic);
  });
});
