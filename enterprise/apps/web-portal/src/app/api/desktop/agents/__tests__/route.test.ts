import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const resolveAssignmentKeysForUser = vi.fn();
const listAgentsVisibleToKeys = vi.fn();
const listAgentsWithMa = vi.fn();
const listMaEnvironments = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  resolveAssignmentKeysForUser: (...args: unknown[]) => resolveAssignmentKeysForUser(...args),
  listAgentsVisibleToKeys: (...args: unknown[]) => listAgentsVisibleToKeys(...args),
  listAgentsWithMa: (...args: unknown[]) => listAgentsWithMa(...args),
  listMaEnvironments: (...args: unknown[]) => listMaEnvironments(...args),
}));

const AGENT = "01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const ENV = "01JQMZ8K3N4P5Q6R7S8T9VWXY0";
const OWNED = "01JQMZ8K3N4P5Q6R7S8T9VWXY1";

function identity() {
  return {
    userId: "u1",
    tenantId: "t1",
    deptId: "d1",
    email: "a@example.invalid",
    displayName: "A",
    tokenId: 1,
    scopes: ["workspace:chat", "desktop:managed"],
  };
}

function agent(patch: Record<string, unknown> = {}) {
  return {
    id: AGENT,
    tenantId: "t1",
    slug: "report-bot",
    displayName: "报告助手",
    description: null,
    systemPrompt: "你是报告助手",
    model: "openai/gpt-4o",
    runtime: "cloud",
    capabilityIds: [],
    assignmentKeys: ["all"],
    workerKeys: [],
    status: "active",
    lifecycle: "published",
    origin: "enterprise",
    ownerUserId: null,
    localAvatarId: null,
    metadata: {},
    createdAt: "2026-10-26T08:00:00.000Z",
    updatedAt: "2026-10-26T08:00:00.000Z",
    ...patch,
  };
}

function request(): Request {
  return new Request("http://localhost:3000/api/desktop/agents");
}

describe("/api/desktop/agents", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    resolveAssignmentKeysForUser.mockReset();
    listAgentsVisibleToKeys.mockReset();
    listAgentsWithMa.mockReset();
    listMaEnvironments.mockReset();
    resolveDesktopIdentity.mockResolvedValue(identity());
    resolveAssignmentKeysForUser.mockResolvedValue(["all"]);
    listMaEnvironments.mockResolvedValue([]);
    listAgentsWithMa.mockResolvedValue([]);
  });

  it("keeps legacy keys and adds managed fields", async () => {
    const row = agent();
    listAgentsVisibleToKeys.mockResolvedValue([row]);
    listAgentsWithMa.mockResolvedValue([{
      ...row,
      latestVersion: 3,
      defaultEnvironmentId: ENV,
      versionRouting: "pinned",
      pinnedVersion: 2,
      effectiveVersion: 2,
    }]);
    listMaEnvironments.mockResolvedValue([{
      id: ENV,
      tenantId: "t1",
      name: "研发桌面",
      description: null,
      type: "desktop_worker",
      config: { type: "desktop_worker", worker_keys: [] },
      status: "active",
      createdBy: null,
      createdAt: "2026-10-26T08:00:00.000Z",
      updatedAt: "2026-10-26T08:00:00.000Z",
    }]);
    const { GET } = await import("../route");
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    const card = body.agents[0];
    expect(Object.keys(card).slice(0, 8)).toEqual([
      "id",
      "slug",
      "displayName",
      "description",
      "runtime",
      "model",
      "origin",
      "systemPrompt",
    ]);
    expect(card.id).toBe(AGENT);
    expect(card.slug).toBe("report-bot");
    expect(card.displayName).toBe("报告助手");
    expect(card.description).toBeNull();
    expect(card.runtime).toBe("cloud");
    expect(card.model).toBe("openai/gpt-4o");
    expect(card.origin).toBe("enterprise");
    expect(card.systemPrompt).toBe("你是报告助手");
    expect(card.effectiveVersion).toBe(2);
    expect(card.latestVersion).toBe(3);
    expect(card.routingMode).toBe("pinned");
    expect(card.defaultEnvironment).toEqual({ id: ENV, name: "研发桌面", type: "desktop_worker" });
    expect(card.executionTarget).toBe("desktop_worker");
    expect(card.ownedByMe).toBe(false);
  });

  it("falls back when enrichment fails", async () => {
    listAgentsVisibleToKeys.mockResolvedValue([agent({ runtime: "desktop_worker" })]);
    listAgentsWithMa.mockRejectedValue(new Error("relation enterprise_agent_versions does not exist"));
    const { GET } = await import("../route");
    const res = await GET(request());
    expect(res.status).toBe(200);
    const card = (await res.json()).agents[0];
    expect(card.latestVersion).toBe(1);
    expect(card.effectiveVersion).toBe(1);
    expect(card.defaultEnvironment).toBeNull();
    expect(card.executionTarget).toBe("desktop_worker");
    expect(card.routingMode).toBe("follow_latest");
  });

  it("marks ownedByMe for own employee agents", async () => {
    const mine = agent({
      id: OWNED,
      origin: "employee",
      ownerUserId: "u1",
      slug: "mine",
      displayName: "我的助手",
    });
    const other = agent({
      id: AGENT,
      origin: "employee",
      ownerUserId: "u2",
      slug: "other",
      displayName: "别人的助手",
    });
    listAgentsVisibleToKeys.mockResolvedValue([mine, other]);
    listAgentsWithMa.mockResolvedValue([
      { ...mine, latestVersion: 1, defaultEnvironmentId: null, versionRouting: "follow_latest", pinnedVersion: null, effectiveVersion: 1 },
      { ...other, latestVersion: 1, defaultEnvironmentId: null, versionRouting: "follow_latest", pinnedVersion: null, effectiveVersion: 1 },
    ]);
    const { GET } = await import("../route");
    const res = await GET(request());
    const cards = (await res.json()).agents;
    expect(cards.find((item: { id: string }) => item.id === OWNED).ownedByMe).toBe(true);
    expect(cards.find((item: { id: string }) => item.id === AGENT).ownedByMe).toBe(false);
  });

  it("returns 401 without identity", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { GET } = await import("../route");
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(listAgentsVisibleToKeys).not.toHaveBeenCalled();
  });
});
