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
