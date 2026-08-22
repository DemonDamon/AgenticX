import assert from "node:assert/strict";
import { test } from "vitest";

import {
  clearPaneAwaitingFreshSession,
  markPaneAwaitingFreshSession,
} from "./pane-fresh-session.ts";
import {
  isNewTaskNavActive,
  shouldKeepWorkspaceVisibleWhenSessionMissing,
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
