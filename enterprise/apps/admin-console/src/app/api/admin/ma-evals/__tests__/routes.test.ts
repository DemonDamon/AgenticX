import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const getAgentVersionMock = vi.fn();
const getMaEnvironmentMock = vi.fn();
const listEvalDatasetsMock = vi.fn();
const listEvalDatasetItemsMock = vi.fn();
const listEvalRubricsMock = vi.fn();
const listEvalRunsMock = vi.fn();
const getEvalCandidateMock = vi.fn();
const getAgentWithMaMock = vi.fn();
const updateAgentMaSettingsMock = vi.fn();
const createAgentVersionMock = vi.fn();
const getMaSessionMock = vi.fn();
const listMaSessionEventsMock = vi.fn();
const appendEvalDatasetItemsMock = vi.fn();
const runtimeInternalMock = vi.fn();
const order: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("@agenticx/iam-core", () => ({
  getAgentVersion: (...args: unknown[]) => getAgentVersionMock(...args),
  getMaEnvironment: (...args: unknown[]) => getMaEnvironmentMock(...args),
  listEvalDatasets: (...args: unknown[]) => listEvalDatasetsMock(...args),
  listEvalDatasetItems: (...args: unknown[]) => listEvalDatasetItemsMock(...args),
  listEvalRubrics: (...args: unknown[]) => listEvalRubricsMock(...args),
  listEvalRuns: (...args: unknown[]) => listEvalRunsMock(...args),
  getEvalCandidate: (...args: unknown[]) => getEvalCandidateMock(...args),
  getAgentWithMa: (...args: unknown[]) => getAgentWithMaMock(...args),
  updateAgentMaSettings: (...args: unknown[]) => updateAgentMaSettingsMock(...args),
  createAgentVersion: (...args: unknown[]) => createAgentVersionMock(...args),
  getMaSession: (...args: unknown[]) => getMaSessionMock(...args),
  listMaSessionEvents: (...args: unknown[]) => listMaSessionEventsMock(...args),
  appendEvalDatasetItems: (...args: unknown[]) => appendEvalDatasetItemsMock(...args),
  AgentVersionConflictError: class AgentVersionConflictError extends Error {},
  AgentManifestInvalidError: class AgentManifestInvalidError extends Error {
    errors: string[] = [];
  },
}));
vi.mock("../../../../../lib/ma/runtime-internal-client", () => ({
  runtimeInternal: (...args: unknown[]) => runtimeInternalMock(...args),
  MaRuntimeUnavailableError: class MaRuntimeUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MaRuntimeUnavailableError";
    }
  },
  MaRuntimeRequestError: class MaRuntimeRequestError extends Error {},
}));

const { POST: postRuns } = await import("../runs/route");
const { POST: applyCandidate } = await import("../candidates/[candidateId]/apply/route");
const { POST: importSession } = await import("../datasets/[datasetId]/items/import-session/route");

const AGENT = "01JBX000000000000000000001";

describe("admin ma-evals routes", () => {
  beforeEach(() => {
    order.length = 0;
    requireAdminScopeMock.mockReset();
    runtimeInternalMock.mockReset();
    getAgentVersionMock.mockReset();
    listEvalDatasetsMock.mockReset();
    listEvalDatasetItemsMock.mockReset();
    listEvalRubricsMock.mockReset();
    getEvalCandidateMock.mockReset();
    getAgentWithMaMock.mockReset();
    updateAgentMaSettingsMock.mockReset();
    createAgentVersionMock.mockReset();
    getMaSessionMock.mockReset();
    listMaSessionEventsMock.mockReset();
    appendEvalDatasetItemsMock.mockReset();
    appendEvalDatasetItemsMock.mockResolvedValue([{ id: "I" }]);
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "admin", tenantId: "tenant_test" } });
    getAgentVersionMock.mockResolvedValue({ version: 3 });
    listEvalDatasetsMock.mockResolvedValue([{ id: "D", name: "销售周报回归", itemCount: 1 }]);
    listEvalDatasetItemsMock.mockResolvedValue([
      { id: "I", position: 1, query: "做周报", expectedAnswer: null, expectedToolTrace: ["file_write"], tags: [] },
    ]);
    listEvalRubricsMock.mockResolvedValue([
      { id: "R", name: "周报标准", version: 2, content: { criteria: "汇总", mode: "binary", rule_checks: [] } },
    ]);
    runtimeInternalMock.mockImplementation(async () => {
      order.push("runtime");
      return { run: { id: "RUN" } };
    });
    updateAgentMaSettingsMock.mockImplementation(async () => {
      order.push("pin");
      return {};
    });
    createAgentVersionMock.mockImplementation(async () => {
      order.push("version");
      return { version: { version: 4 }, created: true };
    });
    getAgentWithMaMock.mockImplementation(async () => {
      order.push("agent");
      return {
        id: AGENT,
        lifecycle: "published",
        versionRouting: "follow_latest",
        effectiveVersion: 3,
        latestVersion: 3,
      };
    });
  });

  it("posts a snapshot with memory mounts", async () => {
    const response = await postRuns(
      new Request("http://localhost/api/admin/ma-evals/runs", {
        method: "POST",
        body: JSON.stringify({
          agent_id: AGENT,
          agent_version: 3,
          environment_id: null,
          dataset_id: "D",
          rubric_id: "R",
          memory_store_ids: ["M1"],
          concurrency: 2,
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = runtimeInternalMock.mock.calls[0]?.[2] as {
      dataset: { items: Array<{ query: string; expected_tool_trace: string[] }> };
      rubric: { version: number; content: { criteria: string } };
      memory_store_ids: string[];
      concurrency: number;
      created_by_user_id: string;
    };
    expect(runtimeInternalMock.mock.calls[0]?.[0]).toBe("POST");
    expect(runtimeInternalMock.mock.calls[0]?.[1]).toBe("/internal/ma/eval-runs");
    expect(body.dataset.items[0]?.query).toBe("做周报");
    expect(body.dataset.items[0]?.expected_tool_trace).toEqual(["file_write"]);
    expect(body.rubric.version).toBe(2);
    expect(body.rubric.content.criteria).toBe("汇总");
    expect(body.memory_store_ids).toEqual(["M1"]);
    expect(body.concurrency).toBe(2);
    expect(body.created_by_user_id).toBe("admin");
  });

  it("returns 503 when the runtime is unreachable", async () => {
    const { MaRuntimeUnavailableError } = await import("../../../../../lib/ma/runtime-internal-client");
    runtimeInternalMock.mockRejectedValue(new MaRuntimeUnavailableError("评测运行时不可达"));
    const response = await postRuns(
      new Request("http://localhost/api/admin/ma-evals/runs", {
        method: "POST",
        body: JSON.stringify({
          agent_id: AGENT,
          agent_version: 3,
          dataset_id: "D",
          rubric_id: "R",
          memory_store_ids: [],
        }),
      }),
    );
    expect(response.status).toBe(503);
    const json = (await response.json()) as { message: string };
    expect(json.message).toContain("评测运行时不可达");
  });

  it("pins follow-latest routing before creating a candidate version", async () => {
    getEvalCandidateMock.mockResolvedValue({
      id: "C",
      status: "proposed",
      agentId: AGENT,
      manifest: { schema: "agx.agent/v1" },
      baseVersion: 3,
    });
    getAgentWithMaMock
      .mockResolvedValueOnce({
        id: AGENT,
        lifecycle: "published",
        versionRouting: "follow_latest",
        effectiveVersion: 3,
        latestVersion: 3,
      })
      .mockResolvedValueOnce({
        id: AGENT,
        lifecycle: "published",
        versionRouting: "pinned",
        effectiveVersion: 3,
        latestVersion: 4,
      });
    const response = await applyCandidate(new Request("http://localhost/apply", { method: "POST" }), {
      params: Promise.resolve({ candidateId: "C" }),
    });
    expect(response.status).toBe(200);
    expect(order.filter((name) => name !== "agent")).toEqual(["pin", "version", "runtime"]);
    expect(updateAgentMaSettingsMock).toHaveBeenCalledWith("tenant_test", AGENT, {
      versionRouting: "pinned",
      pinnedVersion: 3,
    });
    const json = (await response.json()) as { data: { version: number; effective_version: number } };
    expect(json.data.version).toBe(4);
    expect(json.data.effective_version).toBe(3);
  });

  it("returns 502 when the candidate status update fails after the version exists", async () => {
    getEvalCandidateMock.mockResolvedValue({
      id: "C",
      status: "proposed",
      agentId: AGENT,
      manifest: {},
      baseVersion: 2,
    });
    getAgentWithMaMock.mockResolvedValue({
      id: AGENT,
      lifecycle: "draft",
      versionRouting: "pinned",
      effectiveVersion: 2,
      latestVersion: 2,
    });
    runtimeInternalMock.mockRejectedValue(new Error("down"));
    const response = await applyCandidate(new Request("http://localhost/apply", { method: "POST" }), {
      params: Promise.resolve({ candidateId: "C" }),
    });
    expect(response.status).toBe(502);
    const json = (await response.json()) as { message: string };
    expect(json.message).toContain("v4");
  });

  it("does not create another version when the candidate is already applied", async () => {
    getEvalCandidateMock.mockResolvedValue({ id: "C", status: "applied", appliedVersion: 9, agentId: AGENT });
    const response = await applyCandidate(new Request("http://localhost/apply", { method: "POST" }), {
      params: Promise.resolve({ candidateId: "C" }),
    });
    expect(response.status).toBe(200);
    expect(createAgentVersionMock).not.toHaveBeenCalled();
  });

  it("imports the first user message and the last primary answer", async () => {
    getMaSessionMock.mockResolvedValue({ id: "S" });
    listMaSessionEventsMock.mockResolvedValue({
      items: [
        { type: "user.message", threadId: null, event: { content: [{ type: "text", text: "原始问题" }] } },
        { type: "agent.message", threadId: "thread", event: { content: [{ type: "text", text: "旁路" }] } },
        { type: "agent.message", threadId: null, event: { content: [{ type: "text", text: "最终回答" }] } },
      ],
      nextAfterSeq: null,
    });
    const response = await importSession(
      new Request("http://localhost/import", {
        method: "POST",
        body: JSON.stringify({ session_id: "S", use_answer_as_expected: true }),
      }),
      { params: Promise.resolve({ datasetId: "D" }) },
    );
    expect(response.status).toBe(200);
    expect(appendEvalDatasetItemsMock).toHaveBeenCalledWith("tenant_test", "D", [
      expect.objectContaining({ query: "原始问题", expectedAnswer: "最终回答", sourceSessionId: "S" }),
    ]);
  });
});
