import { describe, it, expect } from "vitest";
import {
  getPaneSessionId,
  isPaneStillOnSession,
  normalizeSessionId,
  type PaneSessionLike,
} from "./session-pane-guard";

const paneId = "pane-1";

function panes(currentSessionId: string): PaneSessionLike[] {
  return [{ id: paneId, sessionId: currentSessionId }];
}

describe("normalizeSessionId", () => {
  it("trims whitespace and coerces nullish to empty", () => {
    expect(normalizeSessionId("  sid-a  ")).toBe("sid-a");
    expect(normalizeSessionId(null)).toBe("");
    expect(normalizeSessionId(undefined)).toBe("");
  });
});

describe("isPaneStillOnSession", () => {
  it("returns true when pane still shows the loaded session", () => {
    expect(isPaneStillOnSession(panes("session-a"), paneId, "session-a")).toBe(true);
    expect(isPaneStillOnSession(panes("  session-a  "), paneId, "session-a")).toBe(true);
  });

  it("returns false after fast A→B switch (stale async guard)", () => {
    // User clicked session-a, then session-b before a's tail fetch resolved.
    expect(isPaneStillOnSession(panes("session-b"), paneId, "session-a")).toBe(false);
  });

  it("returns false when pane id is missing from store snapshot", () => {
    expect(isPaneStillOnSession([], paneId, "session-a")).toBe(false);
    expect(isPaneStillOnSession([{ id: "other-pane", sessionId: "session-a" }], paneId, "session-a")).toBe(
      false,
    );
  });

  it("treats empty session ids as distinct from real ids", () => {
    expect(isPaneStillOnSession(panes(""), paneId, "session-a")).toBe(false);
    expect(isPaneStillOnSession(panes("session-a"), paneId, "")).toBe(false);
  });
});

describe("getPaneSessionId", () => {
  it("reads normalized session id for the target pane", () => {
    expect(getPaneSessionId(panes("  sid-x  "), paneId)).toBe("sid-x");
    expect(getPaneSessionId([], paneId)).toBe("");
  });
});
