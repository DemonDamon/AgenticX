import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const getAgentTask = vi.fn();
const failTask = vi.fn();
const getAgent = vi.fn();
const appendAgentMessageAsSystem = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/worker-tasks", () => ({
  getAgentTask: (...args: unknown[]) => getAgentTask(...args),
  failTask: (...args: unknown[]) => failTask(...args),
  WorkerTaskConflictError: class WorkerTaskConflictError extends Error {
    constructor(message = "任务不属于当前设备或已结束") {
      super(message);
      this.name = "WorkerTaskConflictError";
    }
  },
}));

vi.mock("../../../../../lib/collab-room", () => ({
  appendAgentMessageAsSystem: (...args: unknown[]) => appendAgentMessageAsSystem(...args),
}));

vi.mock("@agenticx/iam-core", () => ({
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

const TASK_ID = "01TASK0AAAAAAAAAAAAAAAAA";

function post(body: unknown) {
  return new Request(`http://localhost/api/desktop/worker/tasks/${TASK_ID}/fail`, {
    method: "POST",
    headers: { authorization: "Bearer agx-pat-live", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/worker/tasks/:taskId/fail", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    getAgentTask.mockReset();
    failTask.mockReset();
    getAgent.mockReset();
    appendAgentMessageAsSystem.mockReset();
    appendAgentMessageAsSystem.mockResolvedValue({ id: "notice" });
  });

  it("returns 401 without a desktop identity", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { POST } = await import("../tasks/[taskId]/fail/route");
    const response = await POST(post({ device_id: "device-a1", error: "boom" }), {
      params: Promise.resolve({ taskId: TASK_ID }),
    });
    expect(response.status).toBe(401);
    expect(failTask).not.toHaveBeenCalled();
  });

  it("writes a system notice with the first 200 characters of the error", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    getAgentTask.mockResolvedValue({
      id: TASK_ID,
      tenantId: IDENTITY.tenantId,
      agentId: "01AGENT0AAAAAAAAAAAAAAAA",
      roomId: "01ROOM0AAAAAAAAAAAAAAAAA",
      status: "claimed",
      claimedByUserId: IDENTITY.userId,
      claimedByDevice: "device-a1",
    });
    getAgent.mockResolvedValue({ id: "01AGENT0AAAAAAAAAAAAAAAA", displayName: "桌面助手" });
    failTask.mockResolvedValue({ id: TASK_ID, status: "failed", tenantId: IDENTITY.tenantId, agentId: "01AGENT0AAAAAAAAAAAAAAAA", roomId: "01ROOM0AAAAAAAAAAAAAAAAA" });
    const error = `x${"y".repeat(250)}`;
    const { POST } = await import("../tasks/[taskId]/fail/route");
    const response = await POST(post({ device_id: "device-a1", error }), {
      params: Promise.resolve({ taskId: TASK_ID }),
    });
    expect(response.status).toBe(200);
    expect(appendAgentMessageAsSystem).toHaveBeenCalledWith(
      IDENTITY.tenantId,
      "01ROOM0AAAAAAAAAAAAAAAAA",
      expect.objectContaining({
        senderType: "system",
        content: `智能体「桌面助手」执行失败：${error.slice(0, 200)}`,
      }),
    );
  });
});
