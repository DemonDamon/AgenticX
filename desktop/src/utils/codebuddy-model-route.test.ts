import { describe, expect, it } from "vitest";

import {
  codebuddyModelUsesCustomLocal,
  parseCodebuddyModelsJson,
} from "./codebuddy-model-route";

describe("codebuddy model route", () => {
  it("detects custom-local catalogs", () => {
    const catalog = parseCodebuddyModelsJson(
      JSON.stringify({
        models: [
          { id: "glm-5.3-flash", url: "http://127.0.0.1:8080/v1", apiKey: "k" },
          { id: "deepseek-v4.1-flash" },
        ],
      }),
    );
    expect(codebuddyModelUsesCustomLocal("glm-5.3-flash", catalog)).toBe(true);
    expect(codebuddyModelUsesCustomLocal("deepseek-v4.1-flash", catalog)).toBe(false);
    expect(codebuddyModelUsesCustomLocal("custom-local:glm-5.3-flash", catalog)).toBe(true);
  });
});
