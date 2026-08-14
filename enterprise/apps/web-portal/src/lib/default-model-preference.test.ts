import { describe, expect, it } from "vitest";

import { resolveAvailableDefaultModel } from "./default-model-preference";

const MODELS = [
  { id: "provider/first", isDefault: false },
  { id: "provider/default", isDefault: true },
  { id: "provider/other", isDefault: false },
] as const;

describe("resolveAvailableDefaultModel", () => {
  it("prefers a saved model that is still assigned to the user", () => {
    expect(
      resolveAvailableDefaultModel(MODELS, "provider/other", "provider/first")?.id,
    ).toBe("provider/other");
  });

  it("falls back to the current session model when the saved model was revoked", () => {
    expect(
      resolveAvailableDefaultModel(MODELS, "provider/revoked", "provider/first")?.id,
    ).toBe("provider/first");
  });

  it("uses the administrator default and then the first assigned model", () => {
    expect(resolveAvailableDefaultModel(MODELS, null, "mock-model-v1")?.id).toBe(
      "provider/default",
    );
    expect(
      resolveAvailableDefaultModel(
        MODELS.map((model) => ({ ...model, isDefault: false })),
        null,
        null,
      )?.id,
    ).toBe("provider/first");
  });
});
