import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoNothing = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  getIamDb: () => ({
    select: mockSelect,
    insert: mockInsert,
  }),
  migrateLegacyUserVisibleModelsIfNeeded: vi.fn().mockResolvedValue({ action: "skipped", count: 0 }),
}));

vi.mock("../provider-api-key-crypto", () => ({
  decryptProviderApiKey: (v: string) => v,
}));

function chain(limitResult: unknown[], finalResult?: unknown[]) {
  const limit = vi.fn().mockResolvedValue(limitResult);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue(
    finalResult
      ? {
          where: vi.fn().mockResolvedValue(finalResult),
        }
      : { where }
  );
  return { from, where, limit };
}

describe("listAvailableModelsForUser", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSelect.mockReset();
    mockInsert.mockReset();
    process.env.DEFAULT_TENANT_ID = "01J00000000000000000000001";
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns models assigned to the current user", async () => {
    const providersRead = chain([], [
      {
        providerId: "minimax",
        displayName: "MiniMax",
        baseUrl: "https://example.com",
        apiKeyCipher: "",
        enabled: true,
        isDefault: true,
        route: "third-party",
        models: [{ name: "MiniMax-M2.1", label: "MiniMax-M2.1", enabled: true }],
      },
    ]);
    const userModelsRead = chain([], [
      {
        assignmentKey: "email:admin@agenticx.local",
        modelId: "minimax/MiniMax-M2.1",
      },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead);

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("01J00000000000000000000004", "admin@agenticx.local");

    expect(models).toEqual([
      expect.objectContaining({
        id: "minimax/MiniMax-M2.1",
        provider: "minimax",
        model: "MiniMax-M2.1",
      }),
    ]);
  });
});
