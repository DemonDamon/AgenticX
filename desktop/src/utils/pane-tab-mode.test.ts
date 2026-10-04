import assert from "node:assert/strict";
import { test } from "vitest";

import { shouldUsePaneTabs } from "./pane-tab-mode.ts";

test("single pane never uses tabs", () => {
  assert.equal(
    shouldUsePaneTabs({ containerWidth: 500, paneCount: 1, windowWidth: 680 }),
    false,
  );
});

test("minimum window (680) with two panes uses tabs", () => {
  assert.equal(
    shouldUsePaneTabs({ containerWidth: 680, paneCount: 2, windowWidth: 680 }),
    true,
  );
});

test("default 900px window minus sidebar still splits two panes", () => {
  assert.equal(
    shouldUsePaneTabs({ containerWidth: 660, paneCount: 2, windowWidth: 900 }),
    false,
  );
});

test("wide window splits two panes", () => {
  assert.equal(
    shouldUsePaneTabs({ containerWidth: 1100, paneCount: 2, windowWidth: 1440 }),
    false,
  );
});

test("three panes tab when each would be under the comfort floor", () => {
  assert.equal(
    shouldUsePaneTabs({ containerWidth: 720, paneCount: 3, windowWidth: 1440 }),
    true,
  );
});

test("falls back to window width when container is not measured yet", () => {
  assert.equal(
    shouldUsePaneTabs({ containerWidth: 0, paneCount: 2, windowWidth: 900 }),
    false,
  );
  assert.equal(
    shouldUsePaneTabs({ containerWidth: 0, paneCount: 2, windowWidth: 680 }),
    true,
  );
});
