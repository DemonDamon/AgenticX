import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const sweepExpired = vi.fn();
const claimNextTask = vi.fn();
const listAgents = vi.fn();
const resolveAssignmentKeysForUser = vi.fn();
const getAgent = vi.fn();
const appendAgentMessageAsSystem = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/worker-tasks", () => ({
  sweepExpired: (...args: unknown[]) => sweepExpired(...args),
  claimNextTask: (...args: unknown[]) => claimNextTask(...args),
}));

vi.mock("../../../../../lib/collab-room", () => ({
  appendAgentMessageAsSystem: (...args: unknown[]) => appendAgentMessageAsSystem(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  resolveAssignmentKeysForUser: (...args: unknown[]) => resolveAssignmentKeysForUser(...args),
  getAgent: (...args: unknown[]) => getAgent(...args),
}));

const IDENTITY = {
  userId: "01USER0AAAAAAAAAAAAAAAAA",
  tenantId: "01TENANT0AAAAAAAAAAAAAAA",
  deptId: null,
  email: "alice@example.com",
  displayName: "Alice",
  tokenId: 1,
  scopes: ["desktop:managed"],
};

function post(body: unknown) {
  return new Request("http://localhost/api/desktop/worker/tasks/claim", {
    method: "POST",
    headers: { authorization: "Bearer agx-pat-live", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/worker/tasks/claim", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    sweepExpired.mockReset();
    claimNextTask.mockReset();
    listAgents.mockReset();
    resolveAssignmentKeysForUser.mockReset();
    getAgent.mockReset();
    appendAgentMessageAsSystem.mockReset();
    resolveAssignmentKeysForUser.mockResolvedValue(["all"]);
    listAgents.mockResolvedValue([]);
    sweepExpired.mockResolvedValue([]);
    claimNextTask.mockResolvedValue(null);
    appendAgentMessageAsSystem.mockResolvedValue({ id: "msg" });
  });

  it("returns 401 without a desktop identity", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { POST } = await import("../tasks/claim/route");
    const response = await POST(post({ device_id: "device-a1" }));
    expect(response.status).toBe(401);
    expect(claimNextTask).not.toHaveBeenCalled();
  });

  it("returns task null when the queue is empty", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    const { POST } = await import("../tasks/claim/route");
    const response = await POST(post({ device_id: "device-a1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task: null });
    expect(sweepExpired).toHaveBeenCalledWith(IDENTITY.tenantId);
  });

  it("writes a room notice for tasks the sweep marked failed or expired", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    getAgent.mockImplementation(async (_tenantId: string, agentId: string) => ({
      id: agentId,
      displayName: agentId === "agent-failed" ? "失败助手" : "过期助手",
    }));
    sweepExpired.mockResolvedValue([
      {
        id: "task-failed",
        tenantId: IDENTITY.tenantId,
        agentId: "agent-failed",
        roomId: "room-1",
        status: "failed",
      },
      {
        id: "task-expired",
        tenantId: IDENTITY.tenantId,
        agentId: "agent-expired",
        roomId: "room-2",
        status: "expired",
      },
    ]);
    const { POST } = await import("../tasks/claim/route");
    const response = await POST(post({ device_id: "device-a1" }));
    expect(response.status).toBe(200);
    expect(appendAgentMessageAsSystem).toHaveBeenCalledWith(
      IDENTITY.tenantId,
      "room-1",
      expect.objectContaining({
        senderType: "system",
        content: "智能体「失败助手」多次领取未完成",
      }),
    );
    expect(appendAgentMessageAsSystem).toHaveBeenCalledWith(
      IDENTITY.tenantId,
      "room-2",
      expect.objectContaining({
        senderType: "system",
        content: "智能体「过期助手」24 小时内没有桌面执行端领取",
      }),
    );
  });
});
