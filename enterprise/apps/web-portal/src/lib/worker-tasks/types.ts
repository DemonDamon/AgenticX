export type TaskMessageRole = "user" | "assistant";

export type TaskMessage = {
  role: TaskMessageRole;
  name: string;
  content: string;
};

export type TaskInput = {
  messages: TaskMessage[];
  instruction: string;
};

export type AgentTaskStatus = "queued" | "claimed" | "completed" | "failed" | "expired";

export type AgentTask = {
  id: string;
  tenantId: string;
  agentId: string;
  roomId: string;
  triggerMessageId: string;
  requestedBy: string;
  status: AgentTaskStatus;
  input: TaskInput;
  attempts: number;
  claimedByUserId: string | null;
  claimedByDevice: string | null;
  claimedAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  resultMessageId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueAgentTaskInput = {
  tenantId: string;
  agentId: string;
  roomId: string;
  triggerMessageId: string;
  requestedBy: string;
  input: TaskInput;
};

export class WorkerTaskConflictError extends Error {
  public constructor(message = "任务不属于当前设备或已结束") {
    super(message);
    this.name = "WorkerTaskConflictError";
  }
}
