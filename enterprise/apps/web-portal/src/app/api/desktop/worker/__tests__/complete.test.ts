import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const getAgentTask = vi.fn();
const completeTask = vi.fn();
const getAgent = vi.fn();
const appendAgentMessageAsSystem = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/worker-tasks", () => ({
  getAgentTask: (...args: unknown[]) => getAgentTask(...args),
  completeTask: (...args: unknown[]) => completeTask(...args),
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
const AGENT = {
  id: "01AGENT0AAAAAAAAAAAAAAAA",
  slug: "desktop-coder",
  displayName: "桌面助手",
  systemPrompt: "do the work",
  model: "demo/coder",
};

function post(body: unknown) {
  return new Request(`http://localhost/api/desktop/worker/tasks/${TASK_ID}/complete`, {
    method: "POST",
    headers: { authorization: "Bearer agx-pat-live", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/worker/tasks/:taskId/complete", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    getAgentTask.mockReset();
    completeTask.mockReset();
    getAgent.mockReset();
    appendAgentMessageAsSystem.mockReset();
  });

  it("returns 401 without a desktop identity", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { POST } = await import("../tasks/[taskId]/complete/route");
    const response = await POST(post({ device_id: "device-a1", content: "完成了" }), {
      params: Promise.resolve({ taskId: TASK_ID }),
    });
    expect(response.status).toBe(401);
    expect(appendAgentMessageAsSystem).not.toHaveBeenCalled();
  });

  it("writes an agent room message and completes the task", async () => {
    resolveDesktopIdentity.mockResolvedValue(IDENTITY);
    getAgentTask.mockResolvedValue({
      id: TASK_ID,
      tenantId: IDENTITY.tenantId,
      agentId: AGENT.id,
      roomId: "01ROOM0AAAAAAAAAAAAAAAAA",
      triggerMessageId: "01MSG0AAAAAAAAAAAAAAAAAA",
      status: "claimed",
      claimedByUserId: IDENTITY.userId,
      claimedByDevice: "device-a1",
    });
    getAgent.mockResolvedValue(AGENT);
    appendAgentMessageAsSystem.mockResolvedValue({ id: "01REPLY0AAAAAAAAAAAAAAA" });
    completeTask.mockResolvedValue({ id: TASK_ID, status: "completed" });
    const { POST } = await import("../tasks/[taskId]/complete/route");
    const response = await POST(
      post({ device_id: "device-a1", content: "桌面已执行完成", tool_steps: [{ name: "bash" }] }),
      { params: Promise.resolve({ taskId: TASK_ID }) },
    );
    expect(response.status).toBe(200);
    expect(appendAgentMessageAsSystem).toHaveBeenCalledWith(
      IDENTITY.tenantId,
      "01ROOM0AAAAAAAAAAAAAAAAA",
      expect.objectContaining({
        senderType: "agent",
        senderId: AGENT.id,
        senderName: AGENT.displayName,
        content: "桌面已执行完成",
        metadata: {
          runtime: "desktop_worker",
          reply_to: "01MSG0AAAAAAAAAAAAAAAAAA",
          worker_user_id: IDENTITY.userId,
          worker_device: "device-a1",
          tool_steps: [{ name: "bash" }],
        },
      }),
    );
    expect(completeTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: TASK_ID, resultMessageId: "01REPLY0AAAAAAAAAAAAAAA", deviceId: "device-a1" }),
    );
  });
});
