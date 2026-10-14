import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const listAgentsMock = vi.fn();
const createAgentMock = vi.fn();
const getAgentMock = vi.fn();
const updateAgentMock = vi.fn();
const deleteAgentMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../lib/capability-packs-store", () => ({
  assertCapabilityIds(ids: readonly string[]) {
    const pattern = /^(mcp|skill):[0-9A-HJKMNP-TV-Z]{26}$/;
    const cleaned: string[] = [];
    for (const raw of ids) {
      const id = String(raw ?? "").trim();
      if (!id) continue;
      if (!pattern.test(id)) throw new Error(`invalid capability id: ${id}`);
      if (!cleaned.includes(id)) cleaned.push(id);
    }
    return cleaned;
  },
  normalizeAssignmentKeys(keys: readonly string[]) {
    const cleaned: string[] = [];
    for (const raw of keys) {
      const key = String(raw ?? "").trim();
      if (key && !cleaned.includes(key)) cleaned.push(key);
    }
    return cleaned;
  },
}));

vi.mock("@agenticx/iam-core", () => {
  class AgentValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "AgentValidationError";
    }
  }
  class AgentSlugConflictError extends Error {
    constructor(message = "标识已存在") {
      super(message);
      this.name = "AgentSlugConflictError";
    }
  }
  class AgentNotFoundError extends Error {
    constructor(message = "智能体不存在") {
      super(message);
      this.name = "AgentNotFoundError";
    }
  }
  const slugPattern = /^[a-z0-9][a-z0-9-]{1,62}$/;
  function validateAgentInput(input: {
    slug?: string;
    displayName?: string;
    model?: string;
    runtime?: string;
    assignmentKeys?: string[];
  }) {
    if (!slugPattern.test(String(input.slug ?? "").trim())) throw new AgentValidationError("标识不合法");
    if (!String(input.displayName ?? "").trim()) throw new AgentValidationError("名称不能为空");
    if (!String(input.model ?? "").trim()) throw new AgentValidationError("模型不能为空");
    if (input.runtime !== undefined && input.runtime !== "cloud" && input.runtime !== "desktop_worker") {
      throw new AgentValidationError("运行方式不合法");
    }
    if (input.assignmentKeys !== undefined && input.assignmentKeys.filter((key) => key.trim()).length === 0) {
      throw new AgentValidationError("可见范围不能为空");
    }
  }
  return {
    AgentValidationError,
    AgentSlugConflictError,
    AgentNotFoundError,
    validateAgentInput,
    listAgents: (...args: unknown[]) => listAgentsMock(...args),
    createAgent: (...args: unknown[]) => createAgentMock(...args),
    getAgent: (...args: unknown[]) => getAgentMock(...args),
    updateAgent: (...args: unknown[]) => updateAgentMock(...args),
    deleteAgent: (...args: unknown[]) => deleteAgentMock(...args),
  };
});

const CAPABILITY_ID = "skill:01ARZ3NDEKTSV4RRFFQ69G5FAV";

const { GET, POST } = await import("../route");
const { GET: getAgentRoute, PATCH, DELETE } = await import("../[agentId]/route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin agents routes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    listAgentsMock.mockReset();
    createAgentMock.mockReset();
    getAgentMock.mockReset();
    updateAgentMock.mockReset();
    deleteAgentMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant_test" } });
  });

  it("GET returns agents with the success envelope", async () => {
    listAgentsMock.mockResolvedValue([{ id: "a1", slug: "report-bot" }]);
    const response = await GET();
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["provider:read"]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { code: string; data?: { agents?: Array<{ slug: string }> } };
    expect(body.code).toBe("00000");
    expect(body.data?.agents?.[0]?.slug).toBe("report-bot");
  });

  it("GET returns 500 with a migrate hint when the table is missing", async () => {
    listAgentsMock.mockRejectedValue(new Error('relation "enterprise_agents" does not exist'));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("50000");
    expect(body.message).toMatch(/db:migrate/);
  });

  it("POST maps validation failures to 400", async () => {
    const response = await POST(jsonRequest({ slug: "Report_Bot", displayName: "报告", model: "openai/gpt-4o" }));
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["provider:update"]);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("40000");
    expect(createAgentMock).not.toHaveBeenCalled();
  });

  it("POST maps slug conflicts to 409 and returns the created agent", async () => {
    const { AgentSlugConflictError } = await import("@agenticx/iam-core");
    createAgentMock.mockRejectedValueOnce(new AgentSlugConflictError("标识已存在"));
    const conflict = await POST(
      jsonRequest({
        slug: "report-bot",
        displayName: "报告助手",
        model: "openai/gpt-4o",
        capabilityIds: [CAPABILITY_ID],
        assignmentKeys: ["all"],
      }),
    );
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as { code: string };
    expect(conflictBody.code).toBe("40900");

    createAgentMock.mockResolvedValueOnce({ id: "a1", slug: "report-bot" });
    const created = await POST(
      jsonRequest({
        slug: "report-bot",
        displayName: "报告助手",
        model: "openai/gpt-4o",
        capabilityIds: [CAPABILITY_ID],
        assignmentKeys: ["all"],
      }),
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { code: string; data?: { agent?: { slug: string } } };
    expect(createdBody.code).toBe("00000");
    expect(createdBody.data?.agent?.slug).toBe("report-bot");
  });

  it("item routes map a missing agent to 404", async () => {
    const { AgentNotFoundError } = await import("@agenticx/iam-core");
    getAgentMock.mockRejectedValue(new AgentNotFoundError());
    updateAgentMock.mockRejectedValue(new AgentNotFoundError());
    deleteAgentMock.mockRejectedValue(new AgentNotFoundError());
    const context = { params: Promise.resolve({ agentId: "missing" }) };

    const loaded = await getAgentRoute(new Request("http://localhost"), context);
    expect(loaded.status).toBe(404);
    expect(((await loaded.json()) as { code: string }).code).toBe("40400");

    const patched = await PATCH(jsonRequest({ description: "更新" }), context);
    expect(patched.status).toBe(404);
    expect(((await patched.json()) as { code: string }).code).toBe("40400");

    const removed = await DELETE(new Request("http://localhost"), context);
    expect(removed.status).toBe(404);
    expect(((await removed.json()) as { code: string }).code).toBe("40400");
  });

  it("returns the auth response when the scope check fails", async () => {
    const denied = NextResponse.json({ code: "40300", message: "forbidden" }, { status: 403 });
    requireAdminScopeMock.mockResolvedValue({ ok: false, response: denied });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(listAgentsMock).not.toHaveBeenCalled();
  });
});
