import assert from "node:assert/strict";
import test from "node:test";

import { shouldDisableMcpToggle } from "./mcp-toggle-state.ts";

test("MCP 开关：有会话时即使 busy 也不应被禁用", () => {
  assert.equal(
    shouldDisableMcpToggle({
      hasSession: true,
      isBusy: true,
    }),
    false,
  );
});

test("MCP 开关：没有会话时应禁用", () => {
  assert.equal(
    shouldDisableMcpToggle({
      hasSession: false,
      isBusy: false,
    }),
    true,
  );
});
