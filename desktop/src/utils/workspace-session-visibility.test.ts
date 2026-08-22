import assert from "node:assert/strict";
import { test } from "vitest";

import {
  clearPaneAwaitingFreshSession,
  markPaneAwaitingFreshSession,
} from "./pane-fresh-session.ts";
import {
  bootstrapMarkerForSessionBinding,
  isNewTaskNavActive,
  nextTaskspacePanelOpenOnSessionBind,
  shouldKeepWorkspaceVisibleWhenSessionMissing,
  workspacePanelOpenAfterNewTopic,
  workspacePanelOpenAfterSessionSwitch,
} from "./workspace-session-visibility.ts";

test("keeps workspace visible while waiting for a fresh session", () => {
  assert.equal(shouldKeepWorkspaceVisibleWhenSessionMissing("", true), true);
});

test("does not keep workspace when session already exists", () => {
  assert.equal(shouldKeepWorkspaceVisibleWhenSessionMissing("sid-1", true), false);
});

test("does not keep workspace when not awaiting fresh session", () => {
  assert.equal(shouldKeepWorkspaceVisibleWhenSessionMissing("", false), false);
});

test("new topic does not inherit an open workspace panel", () => {
  assert.equal(workspacePanelOpenAfterNewTopic(), false);
});

test("session switch does not inherit an open workspace panel", () => {
  assert.equal(workspacePanelOpenAfterSessionSwitch(), false);
});

test("binding a different real session closes an open workspace panel", () => {
  assert.equal(
    nextTaskspacePanelOpenOnSessionBind({
      prevSessionId: "sess-a",
      nextSessionId: "sess-b",
      currentlyOpen: true,
    }),
    false,
  );
});

test("rebinding the same session keeps workspace visibility", () => {
  assert.equal(
    nextTaskspacePanelOpenOnSessionBind({
      prevSessionId: "sess-a",
      nextSessionId: "sess-a",
      currentlyOpen: true,
    }),
    true,
  );
  assert.equal(
    nextTaskspacePanelOpenOnSessionBind({
      prevSessionId: "sess-a",
      nextSessionId: "sess-a",
      currentlyOpen: false,
    }),
    false,
  );
});

test("lazy-create empty to real id keeps workspace visibility", () => {
  assert.equal(
    nextTaskspacePanelOpenOnSessionBind({
      prevSessionId: "",
      nextSessionId: "sess-a",
      currentlyOpen: true,
    }),
    true,
  );
});

test("unbinding to empty keeps workspace visibility for new-topic to own", () => {
  assert.equal(
    nextTaskspacePanelOpenOnSessionBind({
      prevSessionId: "sess-a",
      nextSessionId: "",
      currentlyOpen: true,
    }),
    true,
  );
test("skips history bootstrap only for the session freshly created by this pane", () => {
  assert.equal(bootstrapMarkerForSessionBinding("sid-new", "sid-new"), "sid-new");
  assert.equal(bootstrapMarkerForSessionBinding("sid-history", "sid-new"), "");
  assert.equal(bootstrapMarkerForSessionBinding("", "sid-new"), "");
});

test("new task nav active only for meta pane awaiting first send", () => {
  const paneId = "pane-meta-test";
  markPaneAwaitingFreshSession(paneId);
  try {
    assert.equal(
      isNewTaskNavActive("chat", { id: paneId, avatarId: null, sessionId: "" }),
      true
    );
    assert.equal(
      isNewTaskNavActive("chat", { id: paneId, avatarId: null, sessionId: "sid-1" }),
      false
    );
    assert.equal(
      isNewTaskNavActive("avatars", { id: paneId, avatarId: null, sessionId: "" }),
      false
    );
    assert.equal(
      isNewTaskNavActive("chat", { id: paneId, avatarId: "avatar-1", sessionId: "" }),
      false
    );
  } finally {
    clearPaneAwaitingFreshSession(paneId);
  }
});

test("new task nav inactive when meta pane is not awaiting fresh session", () => {
  assert.equal(
    isNewTaskNavActive("chat", { id: "pane-idle", avatarId: null, sessionId: "" }),
    false
  );
});
