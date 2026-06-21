import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoNothing = vi.fn();
const mockWhereDelete = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  getIamDb: () => ({
    select: mockSelect,
    delete: mockDelete,
    insert: mockInsert,
  }),
  getDepartment: vi.fn(async (_tenantId: string, deptId: string) => ({
    id: deptId,
    name: deptId,
    path: `/${deptId}`,
  })),
  listDepartmentAncestorIds: vi.fn(async (_tenantId: string, deptId: string) => [deptId, "dept-parent"]),
}));

vi.mock("../model-providers-store", () => ({
  listAllEnabledModelIds: vi.fn(async () => ["a/b", "c/d", "e/f"]),
}));

vi.mock("../user-models-store", () => ({
  listAllAssignments: vi.fn(async () => ({
    "dept:dept-parent": ["a/b", "c/d"],
  })),
}));

function selectChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  return { from, where };
}

describe("dept-models-store", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSelect.mockReset();
    mockDelete.mockReset();
    mockInsert.mockReset();
    mockWhereDelete.mockReset();
    mockValues.mockReset();
    mockOnConflictDoNothing.mockReset();
    process.env.DEFAULT_TENANT_ID = "01J00000000000000000000001";
    mockDelete.mockReturnValue({ where: mockWhereDelete.mockResolvedValue(undefined) });
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing.mockResolvedValue(undefined) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getDeptModels returns unique model ids for dept key", async () => {
    mockSelect.mockReturnValueOnce(
      selectChain([
        { modelId: "openai/gpt-4" },
        { modelId: "openai/gpt-4" },
        { modelId: "minimax/M2" },
      ]),
    );

    const { getDeptModels } = await import("../dept-models-store");
    const ids = await getDeptModels("dept-frontend");
    expect(ids).toEqual(["openai/gpt-4", "minimax/M2"]);
  });

  it("setDeptModels clips to parent allowed and returns pruned ids", async () => {
    mockSelect.mockReturnValueOnce(selectChain([]));

    const { setDeptModels } = await import("../dept-models-store");
    const saved = await setDeptModels("dept-frontend", ["a/b", "e/f"]);
    expect(saved.modelIds).toEqual(["a/b"]);
    expect(saved.prunedModelIds).toEqual(["e/f"]);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });

  it("setDeptModels with empty list skips insert", async () => {
    const { setDeptModels } = await import("../dept-models-store");
    const saved = await setDeptModels("dept-frontend", []);
    expect(saved.modelIds).toEqual([]);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("deleteDeptAssignment deletes by dept key", async () => {
    const { deleteDeptAssignment } = await import("../dept-models-store");
    await deleteDeptAssignment("dept-frontend");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockWhereDelete).toHaveBeenCalled();
  });

  it("readDeptEditPayload returns parent allowed from cascading semantics", async () => {
    mockSelect.mockReturnValueOnce(selectChain([{ modelId: "a/b" }]));

    const { readDeptEditPayload } = await import("../dept-models-store");
    const payload = await readDeptEditPayload("dept-frontend");
    expect(payload.parentAllowedIds.sort()).toEqual(["a/b", "c/d"]);
    expect(payload.modelIds).toEqual(["a/b"]);
  });
});
