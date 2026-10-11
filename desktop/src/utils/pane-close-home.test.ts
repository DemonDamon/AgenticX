import assert from "node:assert/strict";
import { test } from "vitest";

import { lastPaneCloseAction } from "./pane-close-home.ts";

test("last remaining pane resets to Meta new-task home", () => {
  assert.equal(lastPaneCloseAction(1), "reset-meta-home");
  assert.equal(lastPaneCloseAction(0), "reset-meta-home");
});

test("closing one of several panes removes that pane", () => {
  assert.equal(lastPaneCloseAction(2), "remove");
  assert.equal(lastPaneCloseAction(3), "remove");
});
