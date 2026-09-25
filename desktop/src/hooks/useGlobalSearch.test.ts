import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchConversationHits, findPaneForGlobalSearchHit } from "./useGlobalSearch";

vi.mock("../store", () => ({
  useAppStore: { getState: () => ({ hydrateAttachmentRoutingLocksFromSessions: vi.fn() }) },
}));

describe("global conversation search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes scheduled runs and keeps their automation avatar identity", async () => {
    const searchSessions = vi.fn(async () => ({
      ok: true,
      hits: [
        { session_id: "scheduled-run", snippet: "自动日报已完成" },
        { session_id: "meta-run", snippet: "普通对话" },
      ],
    }));
    const listSessions = vi.fn(async () => ({
      ok: true,
      sessions: [
        {
          session_id: "scheduled-run",
          avatar_id: "automation:daily-report",
          avatar_name: null,
          session_name: "自动日报",
          updated_at: 200,
        },
        {
          session_id: "meta-run",
          avatar_id: null,
          avatar_name: null,
          session_name: "普通对话",
          updated_at: 100,
        },
      ],
    }));
    vi.stubGlobal("window", {
      agenticxDesktop: { searchSessions, listSessions },
    });

    const result = await fetchConversationHits("日报");

    expect(searchSessions).toHaveBeenCalledWith({ q: "日报" });
    expect(listSessions).toHaveBeenCalledWith();
    expect(result.error).toBeUndefined();
    expect(result.hits).toEqual([
      expect.objectContaining({
        sessionId: "scheduled-run",
        avatarId: "automation:daily-report",
        avatarName: "定时任务",
        title: "自动日报",
      }),
      expect.objectContaining({
        sessionId: "meta-run",
        avatarId: null,
        title: "普通对话",
      }),
    ]);
  });

  it("opens an old scheduled run in the matching automation pane", () => {
    const panes = [
      { id: "meta", sessionId: "scheduled-run", avatarId: null },
      { id: "automation-old", sessionId: "other-run", avatarId: "automation:daily-report" },
      { id: "automation-hit", sessionId: "scheduled-run", avatarId: "automation:daily-report" },
    ];
    expect(
      findPaneForGlobalSearchHit(panes, {
        sessionId: "scheduled-run",
        avatarId: "automation:daily-report",
      })?.id,
    ).toBe("automation-hit");
    expect(
      findPaneForGlobalSearchHit(
        [{ id: "meta", sessionId: "scheduled-run", avatarId: null }],
        { sessionId: "scheduled-run", avatarId: "automation:daily-report" },
      ),
    ).toBeUndefined();
  });
});
