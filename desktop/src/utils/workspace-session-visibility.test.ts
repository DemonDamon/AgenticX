import assert from "node:assert/strict";
import test from "node:test";

import { shouldKeepWorkspaceVisibleWhenSessionMissing } from "./workspace-session-visibility.ts";

test("keeps workspace visible while waiting for a fresh session", () => {
  assert.equal(shouldKeepWorkspaceVisibleWhenSessionMissing("", true), true);
});

test("does not keep workspace when session already exists", () => {
  assert.equal(shouldKeepWorkspaceVisibleWhenSessionMissing("sid-1", true), false);
});

test("does not keep workspace when not awaiting fresh session", () => {
  assert.equal(shouldKeepWorkspaceVisibleWhenSessionMissing("", false), false);
});
