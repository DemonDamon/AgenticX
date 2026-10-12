import assert from "node:assert/strict";
import { test } from "vitest";

import { mountModeSwitchForEntry } from "./workspace-mount-mode.ts";

test("reference mount can switch to link", () => {
  const next = mountModeSwitchForEntry({
    mount_mode: "reference",
    source_path: "/Users/damon/myWork/agxhub",
  });
  assert.deepEqual(next, { next: "link", labelKey: "panel.changeToLink" });
});

test("link mount can switch back to reference", () => {
  const next = mountModeSwitchForEntry({
    mount_mode: "link",
    source_path: "/Users/damon/myWork/agxhub",
  });
  assert.deepEqual(next, { next: "reference", labelKey: "panel.changeToReference" });
});

test("copy mount and missing source do not offer a switch", () => {
  assert.equal(
    mountModeSwitchForEntry({
      mount_mode: "copy",
      source_path: "/Users/damon/myWork/agxhub",
    }),
    null,
  );
  assert.equal(mountModeSwitchForEntry({ mount_mode: "reference", source_path: "" }), null);
  assert.equal(mountModeSwitchForEntry({ mount_mode: "reference" }), null);
  assert.equal(mountModeSwitchForEntry({}), null);
});
