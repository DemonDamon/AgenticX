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
  listUserGroupIdsForUser: vi.fn().mockResolvedValue([]),
  groupAssignmentKey: (groupId: string) => `group:${groupId}`,
}));

vi.mock("../provider-api-key-crypto", () => ({
  decryptProviderApiKey: (v: string) => v,
}));

/**
 * 按表分发，而不是按调用顺序排队。
 *
 * listAvailableModelsForUser 里几个读是并发的，谁先真正打到 select 取决于各自
 * await 了几次——顺序一变，mock 就会把 A 的结果喂给 B，而失败长得像业务逻辑错。
 */
function selectRouter(byTable: { providers?: unknown[]; userModels?: unknown[]; quota?: unknown[] }) {
  return () => ({
    from: (table: unknown) => {
      const name = tableName(table);
      const rows =
        name === "enterprise_runtime_model_providers"
          ? byTable.providers ?? []
          : name === "enterprise_runtime_user_visible_models"
            ? byTable.userModels ?? []
            : byTable.quota ?? [];
      return { where: () => resolvable(rows) };
    },
  });
}

function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table as object).find((s) =>
    String(s).includes("Name"),
  );
  return symbol ? String((table as Record<symbol, unknown>)[symbol]) : "";
}

/** `.where(...)` 既要能直接 await，也要能再挂 `.limit(1)`。 */
function resolvable(rows: unknown[]) {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & {
    limit: (n: number) => Promise<unknown[]>;
  };
  promise.limit = () => Promise.resolve(rows);
  return promise;
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
    mockSelect.mockImplementation(
      selectRouter({ providers: [OPENAI_PROVIDER], userModels: [
      { assignmentKey: "email:admin@agenticx.local", modelId: "openai/gpt-4" },
    ] }),
    );

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
    mockSelect.mockImplementation(
      selectRouter({ providers: [OPENAI_PROVIDER], userModels: [
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
    ] }),
    );

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-rd");

    expect(models.map((m) => m.id).sort()).toEqual(["openai/gpt-3.5", "openai/gpt-4"]);
  });

  it("parent=AB child=B user empty → B", async () => {
    mockSelect.mockImplementation(
      selectRouter({ providers: [OPENAI_PROVIDER], userModels: [
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-3.5" },
    ] }),
    );

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-frontend");

    expect(models.map((m) => m.id)).toEqual(["openai/gpt-3.5"]);
  });

  it("parent=AB child=B user=AB → B (clamped)", async () => {
    mockSelect.mockImplementation(
      selectRouter({ providers: [OPENAI_PROVIDER], userModels: [
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-3.5" },
      { assignmentKey: "u_001", modelId: "openai/gpt-4" },
      { assignmentKey: "u_001", modelId: "openai/gpt-3.5" },
    ] }),
    );

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-frontend");

    expect(models.map((m) => m.id)).toEqual(["openai/gpt-3.5"]);
  });

  it("parent=AB child=CD user any → empty", async () => {
    mockSelect.mockImplementation(
      selectRouter({ providers: [OPENAI_PROVIDER], userModels: [
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-4" },
      { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
      { assignmentKey: "dept:dept-frontend", modelId: "openai/gpt-4" },
      { assignmentKey: "u_001", modelId: "openai/gpt-3.5" },
    ] }),
    );

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-frontend");

    expect(models).toEqual([]);
  });

  it("unions a group's models with the user's own, clipped by the department", async () => {
    // 组是授予：本人只有 gpt-3.5，组给了 gpt-4，两个都该看得到。
    const iam = await import("@agenticx/iam-core");
    vi.mocked(iam.listUserGroupIdsForUser).mockResolvedValueOnce(["g_analysts"]);
    mockSelect.mockImplementation(
      selectRouter({
        providers: [OPENAI_PROVIDER],
        userModels: [
          { assignmentKey: "u_001", modelId: "openai/gpt-3.5" },
          { assignmentKey: "group:g_analysts", modelId: "openai/gpt-4" },
        ],
      }),
    );

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001");

    expect(models.map((m) => m.id).sort()).toEqual(["openai/gpt-3.5", "openai/gpt-4"]);
  });

  it("does not let a group widen past the department ceiling", async () => {
    // 部门只放 gpt-3.5；组给的 gpt-4 被夹掉，本人自己那份留下。
    const iam = await import("@agenticx/iam-core");
    vi.mocked(iam.listUserGroupIdsForUser).mockResolvedValueOnce(["g_analysts"]);
    mockSelect.mockImplementation(
      selectRouter({
        providers: [OPENAI_PROVIDER],
        userModels: [
          { assignmentKey: "dept:dept-rd", modelId: "openai/gpt-3.5" },
          { assignmentKey: "u_001", modelId: "openai/gpt-3.5" },
          { assignmentKey: "group:g_analysts", modelId: "openai/gpt-4" },
        ],
      }),
    );

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_001", undefined, "dept-rd");

    expect(models.map((m) => m.id)).toEqual(["openai/gpt-3.5"]);
  });

  it("no assignments anywhere → all enabled models", async () => {
    mockSelect.mockImplementation(
      selectRouter({ providers: [OPENAI_PROVIDER], userModels: [] }),
    );

    const { listAvailableModelsForUser } = await import("../admin-providers-reader");
    const models = await listAvailableModelsForUser("u_new");

    expect(models.map((m) => m.id).sort()).toEqual(["openai/gpt-3.5", "openai/gpt-4"]);
  });
});
