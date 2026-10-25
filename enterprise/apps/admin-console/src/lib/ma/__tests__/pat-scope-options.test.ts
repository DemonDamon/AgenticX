import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAT_SCOPES } from "@agenticx/core-api";

import { MA_PAT_SCOPE_OPTIONS } from "../pat-scope-options";

describe("pat scope options", () => {
  it("matches core-api PAT_SCOPES exactly", () => {
    expect([...MA_PAT_SCOPE_OPTIONS]).toEqual([...PAT_SCOPES]);
  });

  it("does not import @agenticx/core-api", () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../pat-scope-options.ts"),
      "utf8",
    );
    expect(source).not.toContain("@agenticx/core-api");
  });
});
