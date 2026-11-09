import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoNothing = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  resolveDatabaseConfig: () => ({
    dialect: "postgresql",
    url: "postgresql://postgres:postgres@127.0.0.1:5432/agenticx",
  }),
  createMysqlDb: vi.fn(async () => {
    throw new Error("createMysqlDb should not be called in PG unit tests");
  }),
  getIamDb: () => ({
    select: mockSelect,
    insert: mockInsert,
  }),
  migrateLegacyUserVisibleModelsIfNeeded: vi.fn().mockResolvedValue({ action: "skipped", count: 0 }),
  listDepartmentAncestorIds: vi.fn(async (_tenantId: string, deptId: string) => {
    if (deptId === "dept-frontend") return ["dept-frontend", "dept-rd"];
    return [deptId];
  }),
}));

vi.mock("../provider-api-key-crypto", () => ({
  decryptProviderApiKey: (v: string) => v,
}));

function chain(finalResult: unknown[]) {
  const where = vi.fn().mockResolvedValue(finalResult);
  const from = vi.fn().mockReturnValue({ where });
  return { from, where };
}

const OPENAI_PROVIDER = {
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
};

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

  it("returns user-assigned models intersected with all enabled when no dept", async () => {
    const providersRead = chain([OPENAI_PROVIDER]);
    const userModelsRead = chain([
      { assignmentKey: "email:admin@agenticx.local", modelId: "openai/gpt-4" },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead).mockReturnValueOnce(chain([]));

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("01J00000000000000000000004", "admin@agenticx.local");

    expect(models).toEqual([
      expect.objectContaining({
        id: "openai/gpt-4",
        provider: "openai",
        model: "gpt-4",
      }),
    ]);
  });

  it("parent=AB child empty user empty → AB", async () => {
    const providersRead = chain([OPENAI_PROVIDER]);
    const userModelsRead = chain([
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead).mockReturnValueOnce(chain([]));

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-rd");

    expect(models.map((m) => m.id).sort()).toEqual(["openai/gpt-3.5", "openai/gpt-4"]);
  });

  it("parent=AB child=B user empty → B", async () => {
    const providersRead = chain([OPENAI_PROVIDER]);
    const userModelsRead = chain([
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-3.5" },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead).mockReturnValueOnce(chain([]));

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-frontend");

    expect(models.map((m) => m.id)).toEqual(["openai/gpt-3.5"]);
  });

  it("parent=AB child=B user=AB → B (clamped)", async () => {
    const providersRead = chain([OPENAI_PROVIDER]);
    const userModelsRead = chain([
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-3.5" },
      { assignmentKey: "u_001", modelId: "openai/gpt-4" },
      { assignmentKey: "u_001", modelId: "openai/gpt-3.5" },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead).mockReturnValueOnce(chain([]));

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-frontend");

    expect(models.map((m) => m.id)).toEqual(["openai/gpt-3.5"]);
  });

  it("parent=AB child=CD user any → empty", async () => {
    const providersRead = chain([OPENAI_PROVIDER]);
    const userModelsRead = chain([
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-4" },
      { assignmentKey: "u_001", modelId: "openai/gpt-3.5" },
    ]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead).mockReturnValueOnce(chain([]));

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-frontend");

    expect(models).toEqual([]);
  });

  it("no assignments anywhere → all enabled models", async () => {
    const providersRead = chain([OPENAI_PROVIDER]);
    const userModelsRead = chain([]);

    mockSelect.mockReturnValueOnce(providersRead).mockReturnValueOnce(userModelsRead).mockReturnValueOnce(chain([]));

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_new");

    expect(models.map((m) => m.id).sort()).toEqual(["openai/gpt-3.5", "openai/gpt-4"]);
  });

  it("shows a virtual model only when every target is visible", async () => {
    const providersRead = chain([OPENAI_PROVIDER]);
    const userModelsRead = chain([]);
    const virtualRead = chain([
      {
        name: "team-default",
        displayName: "团队默认",
        enabled: true,
        targets: [{ model: "gpt-4" }, { model: "openai/gpt-3.5" }],
      },
      {
        name: "partial",
        displayName: "缺目标",
        enabled: true,
        targets: [{ model: "gpt-4" }, { model: "missing-model" }],
      },
      { name: "retired", displayName: "已停用", enabled: false, targets: [{ model: "gpt-4" }] },
    ]);
    mockSelect
      .mockReturnValueOnce(providersRead)
      .mockReturnValueOnce(userModelsRead)
      .mockReturnValueOnce(virtualRead);

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_new");
    const ids = models.map((m) => m.id);

    expect(ids).toContain("team-default");
    expect(ids).not.toContain("partial");
    expect(ids).not.toContain("retired");
    expect(models.find((m) => m.id === "team-default")).toEqual(
      expect.objectContaining({ model: "team-default", label: "团队默认", provider: "virtual" }),
    );
  });

  it("hides a virtual model when a prefixed target is outside the visible set", async () => {
    const providersRead = chain([OPENAI_PROVIDER]);
    const userModelsRead = chain([
      { assignmentKey: "u_001", modelId: "openai/gpt-4" },
    ]);
    const virtualRead = chain([
      { name: "only-gpt4", displayName: "只用四", enabled: true, targets: [{ model: "openai/gpt-4" }] },
      { name: "needs-3-5", displayName: "还要三点五", enabled: true, targets: [{ model: "gpt-3.5" }] },
    ]);
    mockSelect
      .mockReturnValueOnce(providersRead)
      .mockReturnValueOnce(userModelsRead)
      .mockReturnValueOnce(virtualRead);

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const ids = (await listAvailableModelsForUser("u_001")).map((m) => m.id);

    expect(ids).toContain("only-gpt4");
    expect(ids).not.toContain("needs-3-5");
  });
});
