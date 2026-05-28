#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PTT_SHORTCUT_PRESET,
  formatPttShortcutLabel,
  matchPttShortcut,
  presetToShortcut,
  shouldStopPttOnKeyUp,
} from "./ptt-config.ts";

test("presetToShortcut maps ctrl+space", () => {
  const shortcut = presetToShortcut("ctrl+space");
  assert.equal(shortcut.code, "Space");
  assert.equal(shortcut.ctrlKey, true);
  assert.equal(shortcut.onlyWhenComposerEmpty, false);
});

test("matchPttShortcut respects composer empty guard", () => {
  const shortcut = presetToShortcut("space-empty");
  assert.equal(
    matchPttShortcut(
      { code: "Space", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
      shortcut,
      false
    ),
    false
  );
  assert.equal(
    matchPttShortcut(
      { code: "Space", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
      shortcut,
      true
    ),
    true
  );
});

test("shouldStopPttOnKeyUp tracks active session by key code", () => {
  const shortcut = presetToShortcut(DEFAULT_PTT_SHORTCUT_PRESET);
  assert.equal(shouldStopPttOnKeyUp({ code: "Space" }, shortcut, true), true);
  assert.equal(shouldStopPttOnKeyUp({ code: "Enter" }, shortcut, true), false);
  assert.equal(shouldStopPttOnKeyUp({ code: "Space" }, shortcut, false), false);
});

test("formatPttShortcutLabel returns readable preset name", () => {
  assert.match(formatPttShortcutLabel("ctrl+space"), /Ctrl/i);
});
