import { describe, expect, it } from "vitest";
import {
  existingGroupPaneNeedsBind,
  pickConfirmedGroupSessionId,
  pickOptimisticGroupSessionId,
  shouldCreateGroupSession,
  shouldSkipGroupSessionListOnOpen,
} from "./group-pane-open";

const GROUP = "group:g1";

describe("pickOptimisticGroupSessionId", () => {
  it("returns the remembered sid so the pane can bind before listSessions", () => {
    expect(pickOptimisticGroupSessionId(" sid-remembered ")).toBe("sid-remembered");
  });

  it("returns undefined when nothing is remembered", () => {
    expect(pickOptimisticGroupSessionId(null)).toBeUndefined();
    expect(pickOptimisticGroupSessionId("")).toBeUndefined();
  });
});

describe("pickConfirmedGroupSessionId", () => {
  it("keeps the remembered sid when it is still in the listed group sessions", () => {
    expect(
      pickConfirmedGroupSessionId({
        rememberedSid: "sid-old",
        groupAvatarId: GROUP,
        listed: [
          { session_id: "sid-new", avatar_id: GROUP, updated_at: 20 },
          { session_id: "sid-old", avatar_id: GROUP, updated_at: 10 },
        ],
      })
    ).toBe("sid-old");
  });

  it("falls back to the most recent listed group session when remembered is gone", () => {
    expect(
      pickConfirmedGroupSessionId({
        rememberedSid: "sid-deleted",
        groupAvatarId: GROUP,
        listed: [
          { session_id: "sid-older", avatar_id: GROUP, updated_at: 10 },
          { session_id: "sid-latest", avatar_id: GROUP, updated_at: 30 },
          { session_id: "sid-other", avatar_id: "avatar-x", updated_at: 99 },
        ],
      })
    ).toBe("sid-latest");
  });

  it("ignores archived rows when picking the most recent session", () => {
    expect(
      pickConfirmedGroupSessionId({
        rememberedSid: null,
        groupAvatarId: GROUP,
        listed: [
          { session_id: "sid-archived", avatar_id: GROUP, updated_at: 50, archived: true },
          { session_id: "sid-live", avatar_id: GROUP, updated_at: 10 },
        ],
      })
    ).toBe("sid-live");
  });

  it("returns undefined when the list has no matching group session", () => {
    expect(
      pickConfirmedGroupSessionId({
        rememberedSid: "sid-empty",
        groupAvatarId: GROUP,
        listed: [{ session_id: "sid-meta", avatar_id: null, updated_at: 1 }],
      })
    ).toBeUndefined();
  });
});

describe("existingGroupPaneNeedsBind", () => {
  it("does not rebind a pane that already has a session", () => {
    expect(existingGroupPaneNeedsBind("sid-1")).toBe(false);
  });

  it("rebinds an existing pane stuck without a session id", () => {
    expect(existingGroupPaneNeedsBind("")).toBe(true);
    expect(existingGroupPaneNeedsBind(undefined)).toBe(true);
  });
});

describe("shouldSkipGroupSessionListOnOpen", () => {
  it("skips listSessions once the optimistic sid is already bound", () => {
    expect(
      shouldSkipGroupSessionListOnOpen({
        optimisticSid: "sid-remembered",
        currentSid: "sid-remembered",
      })
    ).toBe(true);
  });

  it("does not skip when the pane still has no session id", () => {
    expect(
      shouldSkipGroupSessionListOnOpen({ optimisticSid: "sid-remembered", currentSid: "" })
    ).toBe(false);
    expect(shouldSkipGroupSessionListOnOpen({ optimisticSid: "", currentSid: "" })).toBe(false);
  });
});

describe("shouldCreateGroupSession", () => {
  it("does not create when list confirmed a session", () => {
    expect(shouldCreateGroupSession({ confirmedSid: "sid-1", currentSid: "" })).toBe(false);
  });

  it("does not create when the pane already has an optimistic sid (empty sessions are hidden from list)", () => {
    expect(shouldCreateGroupSession({ confirmedSid: undefined, currentSid: "sid-optimistic" })).toBe(
      false
    );
  });

  it("creates only when list missed and the pane still has no sid", () => {
    expect(shouldCreateGroupSession({ confirmedSid: undefined, currentSid: "" })).toBe(true);
  });
});
