import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for PR #304: `clearCodebuddyLoginAwaitingRetry` must be bound
 * from the store before any hook dependency array evaluates it (TDZ ReferenceError on mount).
 */
describe("ChatPane codebuddy login store binding order", () => {
  it("binds clearCodebuddyLoginAwaitingRetry before the awaiting-retry useEffect", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "ChatPane.tsx"),
      "utf8",
    );
    const bindIdx = source.indexOf(
      "const clearCodebuddyLoginAwaitingRetry = useAppStore((s) => s.clearCodebuddyLoginAwaitingRetry)",
    );
    const effectNeedle = "clearCodebuddyLoginAwaitingRetry(pane.id)";
    const effectIdx = source.indexOf(effectNeedle);
    expect(bindIdx).toBeGreaterThan(-1);
    expect(effectIdx).toBeGreaterThan(-1);
    expect(bindIdx).toBeLessThan(effectIdx);
  });
});
