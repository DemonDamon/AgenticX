import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/session", () => ({
  getSessionFromCookies: vi.fn(),
}));

vi.mock("@agenticx/iam-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agenticx/iam-core")>();
  return {
    ...actual,
    resolveAssignmentKeysForUser: vi.fn(),
    listAgentsVisibleToKeys: vi.fn(),
  };
});

import type { EnterpriseAgent } from "@agenticx/iam-core";
import { listAgentsVisibleToKeys, resolveAssignmentKeysForUser } from "@agenticx/iam-core";
import { getSessionFromCookies } from "../../../../lib/session";
import { GET } from "./route";

const session = {
  userId: "01HZX3NDEKTSV4RRFFQ69G5FAV",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  email: "admin@agenticx.local",
  deptId: "dept-1",
  scopes: [],
  sessionId: "sess-1",
  mustChangePassword: false,
};

const visible: EnterpriseAgent = {
  id: "01AGENT0AAAAAAAAAAAAAAAAAA",
  tenantId: session.tenantId,
  slug: "report-bot",
  displayName: "验收助手",
  description: "报表",
  systemPrompt: "do-not-leak-system-prompt",
  model: "demo/reply-model",
  runtime: "cloud",
  capabilityIds: [],
  assignmentKeys: ["all"],
  status: "active",
  metadata: {},
  createdAt: "2026-10-14T00:00:00.000Z",
  updatedAt: "2026-10-14T00:00:00.000Z",
};

const hidden: EnterpriseAgent = {
  ...visible,
  id: "01AGENT1AAAAAAAAAAAAAAAAAA",
  slug: "hidden-bot",
  displayName: "隐藏助手",
  systemPrompt: "hidden-secret",
  assignmentKeys: ["dept:other"],
};

describe("GET /api/me/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionFromCookies).mockResolvedValue(session);
    vi.mocked(resolveAssignmentKeysForUser).mockResolvedValue(["all", session.userId]);
    vi.mocked(listAgentsVisibleToKeys).mockImplementation(async (_tenantId, keys) => {
      const wanted = new Set(keys);
      return [visible, hidden].filter((agent) => agent.assignmentKeys.some((key) => wanted.has(key)));
    });
  });

  it("returns only visible agents and omits systemPrompt", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(resolveAssignmentKeysForUser).toHaveBeenCalledWith(
      session.tenantId,
      session.userId,
      session.email,
      session.deptId,
    );
    expect(listAgentsVisibleToKeys).toHaveBeenCalledWith(session.tenantId, ["all", session.userId]);
    const body = (await res.json()) as {
      data: { agents: Array<Record<string, unknown>> };
    };
    expect(body.data.agents).toEqual([
      {
        id: visible.id,
        slug: visible.slug,
        displayName: visible.displayName,
        description: visible.description,
        runtime: visible.runtime,
        model: visible.model,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("systemPrompt");
    expect(JSON.stringify(body)).not.toContain("do-not-leak-system-prompt");
    expect(JSON.stringify(body)).not.toContain("hidden-bot");
  });

  it("rejects a missing session", async () => {
    vi.mocked(getSessionFromCookies).mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listAgentsVisibleToKeys).not.toHaveBeenCalled();
  });
});
