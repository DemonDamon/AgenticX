import assert from "node:assert/strict";
import { test } from "vitest";

import { createGlobalSearchWorkspaceDetail } from "./global-search-events";

test("workspace request targets the pane that opened global search", () => {
  assert.deepEqual(
    createGlobalSearchWorkspaceDetail("pane-meta", "/Users/demo/Documents"),
    {
      paneId: "pane-meta",
      folderPath: "/Users/demo/Documents",
    },
  );
});
