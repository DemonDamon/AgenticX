import assert from "node:assert/strict";
import { test } from "vitest";

import {
  COMPOSE_PREVIEW_PANE_ID,
  filterDurablePanes,
  isComposePreviewPane,
  persistActivePaneId,
} from "./compose-preview.ts";

test("only the composePreview flag marks a transient pane", () => {
  assert.equal(isComposePreviewPane({ id: COMPOSE_PREVIEW_PANE_ID }), false);
  assert.equal(isComposePreviewPane({ id: COMPOSE_PREVIEW_PANE_ID, composePreview: true }), true);
  assert.equal(isComposePreviewPane({ id: "pane-meta" }), false);
});

test("durable filter drops the preview pane and persist keeps a real tab id", () => {
  const panes = [
    { id: "pane-meta", composePreview: undefined },
    { id: COMPOSE_PREVIEW_PANE_ID, composePreview: true },
  ];
  assert.deepEqual(filterDurablePanes(panes).map((pane) => pane.id), ["pane-meta"]);
  assert.equal(persistActivePaneId(COMPOSE_PREVIEW_PANE_ID, panes), "pane-meta");
  assert.equal(persistActivePaneId("pane-meta", panes), "pane-meta");
});
