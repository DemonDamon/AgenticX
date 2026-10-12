import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchConversationHits, findPaneForGlobalSearchHit } from "./useGlobalSearch";

vi.mock("../store", () => ({
  useAppStore: {
    getState: () => ({
      hydrateAttachmentRoutingLocksFromSessions: vi.fn(),
      panes: [],
      hiddenScratchSessionIds: [],
    }),
  },
}));

describe("global conversation search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps scheduled runs in conversation hits with the automation fallback name", async () => {
    vi.stubGlobal("window", {
      agenticxDesktop: {
        searchSessions: vi.fn().mockResolvedValue({
          ok: true,
          hits: [{ session_id: "sched-1", snippet: "日报内容" }],
        }),
        listSessions: vi.fn().mockResolvedValue({
          ok: true,
          sessions: [
            {
              session_id: "sched-1",
              avatar_id: "automation:daily-report",
              session_name: "",
              avatar_name: "",
            },
          ],
        }),
      },
    });
    const { hits } = await fetchConversationHits("日报");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sessionId).toBe("sched-1");
    expect(hits[0]?.avatarId).toBe("automation:daily-report");
    expect(hits[0]?.avatarName).toBe("定时任务");
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
