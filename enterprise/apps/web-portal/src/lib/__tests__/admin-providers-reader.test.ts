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
  listDepartmentAncestorIds: vi.fn(async (_tenantId: string, deptId: string) => [deptId]),
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

  it("includes dept-assigned models when deptId is provided", async () => {
    const providersRead = chain([], [
      {
        providerId: "openai",
        displayName: "OpenAI",
        baseUrl: "https://example.com",
        apiKeyCipher: "",
        enabled: true,
        isDefault: false,
        route: "third-party",
        models: [
          { name: "gpt-4", label: "GPT-4", enabled: true },
          { name: "gpt-3.5", label: "GPT-3.5", enabled: true },
        ],
      },
    ]);
    const userModelsRead = chain([], [
      { assignmentKey: "u_001", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-3.5" },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead);

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-frontend");

    expect(models.map((m) => m.id).sort()).toEqual(["openai/gpt-3.5", "openai/gpt-4"]);
  });

  it("does not include dept models when deptId is omitted", async () => {
    const providersRead = chain([], [
      {
        providerId: "openai",
        displayName: "OpenAI",
        baseUrl: "https://example.com",
        apiKeyCipher: "",
        enabled: true,
        isDefault: false,
        route: "third-party",
        models: [
          { name: "gpt-4", label: "GPT-4", enabled: true },
          { name: "gpt-3.5", label: "GPT-3.5", enabled: true },
        ],
      },
    ]);
    const userModelsRead = chain([], [
      { assignmentKey: "u_001", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-3.5" },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead);

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001");

    expect(models.map((m) => m.id)).toEqual(["openai/gpt-4"]);
  });

  it("includes parent department models when deptId is a child dept", async () => {
    const { listDepartmentAncestorIds } = await import("@agenticx/iam-core");
    vi.mocked(listDepartmentAncestorIds).mockResolvedValueOnce(["dept-frontend", "dept-rd"]);

    const providersRead = chain([], [
      {
        providerId: "openai",
        displayName: "OpenAI",
        baseUrl: "https://example.com",
        apiKeyCipher: "",
        enabled: true,
        isDefault: false,
        route: "third-party",
        models: [
          { name: "gpt-4", label: "GPT-4", enabled: true },
          { name: "gpt-3.5", label: "GPT-3.5", enabled: true },
        ],
      },
    ]);
    const userModelsRead = chain([], [
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-3.5" },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead);

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-frontend");

    expect(models.map((m) => m.id).sort()).toEqual(["openai/gpt-3.5", "openai/gpt-4"]);
  });
});
